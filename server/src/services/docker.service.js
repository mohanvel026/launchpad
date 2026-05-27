const { execSync, spawn } = require('child_process');
const Docker              = require('dockerode');
const { emitLog }         = require('../sockets/logs.socket');

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

/**
 * Build a Docker image from a directory and stream logs to the socket.
 * @param {string} contextDir  - Path to the build context (repo dir with Dockerfile)
 * @param {string} imageTag    - Image tag, e.g. launchpad-<projectId>:<deploymentId>
 * @param {string} deploymentId
 */
const buildImage = (contextDir, imageTag, deploymentId) => {
  return new Promise((resolve, reject) => {
    // Use docker CLI for simpler log streaming
    const args = ['build', '-t', imageTag, contextDir];
    const proc = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    const handleLine = async (data) => {
      const lines = data.toString().split('\n').filter(Boolean);
      for (const line of lines) {
        emitLog(deploymentId, `[${new Date().toISOString()}] ${line}`);
      }
    };

    proc.stdout.on('data', handleLine);
    proc.stderr.on('data', handleLine);

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(imageTag);
      } else {
        reject(new Error(`Docker build exited with code ${code}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`Docker build error: ${err.message}`)));
  });
};

/**
 * Run a container from an image, exposing a host port.
 * @param {string} imageTag
 * @param {number} hostPort
 * @param {object} envVars   - { KEY: 'value', ... }
 * @param {string} deploymentId
 * @param {number} [containerPort=3000]
 * @returns {string} containerId
 */
const runContainer = async (imageTag, hostPort, envVars = {}, deploymentId, containerPort = 3000, cpuLimit = 0.5, ramLimitMB = 512) => {
  const env = Object.entries(envVars).map(([k, v]) => `${k}=${v}`);

  // Ensure PORT env var matches what the container actually listens on
  if (!env.find(e => e.startsWith('PORT='))) {
    env.push(`PORT=${containerPort}`);
  }

  const portBinding = {};
  portBinding[`${containerPort}/tcp`] = [{ HostPort: String(hostPort) }];

  const exposedPorts = {};
  exposedPorts[`${containerPort}/tcp`] = {};

  const container = await docker.createContainer({
    Image:        imageTag,
    Env:          env,
    ExposedPorts: exposedPorts,
    HostConfig: {
      PortBindings:  portBinding,
      RestartPolicy: { Name: 'unless-stopped' },
      Memory:        ramLimitMB * 1024 * 1024,
      NanoCpus:      cpuLimit * 1_000_000_000,
    },
  });

  await container.start();
  emitLog(deploymentId, `[${new Date().toISOString()}] ✅ Container started: ${container.id.slice(0, 12)} → :${hostPort}`);
  return container.id;
};

/**
 * Stop and remove a container by ID.
 * @param {string} containerId
 */
const stopContainer = async (containerId) => {
  try {
    const container = docker.getContainer(containerId);
    const info = await container.inspect();
    if (info.State.Running) {
      await container.stop({ t: 10 });
    }
    await container.remove({ force: true });
  } catch (err) {
    // Container may already be gone — not a fatal error
    console.warn(`stopContainer: ${err.message}`);
  }
};

/**
 * Remove a Docker image by tag.
 * @param {string} imageTag
 */
const removeImage = async (imageTag) => {
  try {
    const image = docker.getImage(imageTag);
    await image.remove({ force: true });
  } catch (err) {
    console.warn(`removeImage: ${err.message}`);
  }
};

/**
 * Get container stats (CPU, memory) for a running container.
 * @param {string} containerId
 * @returns {object|null}
 */
const getContainerStats = async (containerId) => {
  try {
    const container = docker.getContainer(containerId);
    const stats = await container.stats({ stream: false });

    const cpuDelta   = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
    const systemDelta = stats.cpu_stats.system_cpu_usage   - stats.precpu_stats.system_cpu_usage;
    const numCpus    = stats.cpu_stats.online_cpus || 1;
    const cpuPct     = systemDelta > 0 ? (cpuDelta / systemDelta) * numCpus * 100 : 0;

    const memUsage   = stats.memory_stats.usage || 0;
    const memLimit   = stats.memory_stats.limit || 1;
    const memMB      = Math.round(memUsage / 1024 / 1024);
    const memLimitMB = Math.round(memLimit  / 1024 / 1024);
    const memPct     = Math.round((memUsage / memLimit) * 100);

    const rxBytes = Object.values(stats.networks || {}).reduce((s, n) => s + n.rx_bytes, 0);
    const txBytes = Object.values(stats.networks || {}).reduce((s, n) => s + n.tx_bytes, 0);

    return {
      cpu:      parseFloat(cpuPct.toFixed(1)),
      memMB,
      memLimit: memLimitMB,
      memPct,
      rxMB:     parseFloat((rxBytes / 1024 / 1024).toFixed(2)),
      txMB:     parseFloat((txBytes / 1024 / 1024).toFixed(2)),
      status:   stats.id ? 'running' : 'stopped',
    };
  } catch {
    return null;
  }
};

module.exports = { buildImage, runContainer, stopContainer, removeImage, getContainerStats };
