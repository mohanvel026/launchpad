const Queue        = require('bull');
const path         = require('path');
const fs           = require('fs');
const { execSync } = require('child_process');
const CryptoJS     = require('crypto-js');

const Deployment = require('../models/Deployment.model');
const Project    = require('../models/Project.model');
const EnvVar     = require('../models/EnvVar.model');

const { buildImage, runContainer, stopContainer } = require('../services/docker.service');
const { detectStack, generateDockerfile }         = require('../services/stackDetector.service');
const { analyzeError }                            = require('../services/ai.service');
const { createNginxConfig }                       = require('../services/nginx.service');
const { createSubdomain }                         = require('../services/cloudflare.service');
const { provisionSSL }                            = require('../services/ssl.service');
const { getNextFreePort }                         = require('../services/portAllocator.service');
const { emitLog }                                 = require('../sockets/logs.socket');
const { sendDeployNotification }                  = require('../services/notification.service');

const buildQueue = new Queue('builds', {
  redis: {
    host: process.env.REDIS_HOST || '127.0.0.1',
    port: parseInt(process.env.REDIS_PORT) || 6379,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  },
});

const REPOS_DIR = path.join(__dirname, '../../repos');
if (!fs.existsSync(REPOS_DIR)) fs.mkdirSync(REPOS_DIR, { recursive: true });

const decryptValue = (encrypted) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, process.env.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || encrypted;
  } catch { return encrypted; }
};

const isWindows = process.platform === 'win32';

buildQueue.process(async (job) => {
  const { deploymentId, projectId } = job.data;

  const deployment = await Deployment.findById(deploymentId);
  const project    = await Project.findById(projectId).populate('owner', 'email username');
  if (!deployment || !project) throw new Error('Deployment or project not found');

  const log = async (msg) => {
    const line = `[${new Date().toISOString()}] ${msg}`;
    emitLog(deploymentId, line);
    await Deployment.findByIdAndUpdate(deploymentId, { $push: { logs: line } });
  };

  await deployment.updateOne({ status: 'building', startedAt: new Date() });
  await Project.findByIdAndUpdate(projectId, { status: 'building' });

  const repoDir  = path.join(REPOS_DIR, projectId);
  const imageTag = `launchpad-${projectId}:${deploymentId}`;
  const startedAt = new Date();

  try {
    // ── 1. Clone or pull ─────────────────────────────────────────────────────
    await log(`Cloning ${project.repoFullName} (${project.branch})…`);
    if (fs.existsSync(repoDir)) {
      execSync(`git -C "${repoDir}" fetch --all && git -C "${repoDir}" reset --hard origin/${project.branch}`, { stdio: 'pipe' });
    } else {
      execSync(`git clone --branch ${project.branch} --depth 1 ${project.repoUrl} "${repoDir}"`, { stdio: 'pipe' });
    }
    await log('Repository cloned successfully.');

    // ── 2. Detect stack + write Dockerfile ───────────────────────────────────
    const stack = detectStack(repoDir);
    await log(`Stack detected: ${stack}`);
    await Project.findByIdAndUpdate(projectId, { stack });

    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), generateDockerfile(stack));
    await log('Dockerfile written.');

    // ── 3. Docker steps (Linux/Oracle Cloud only) ────────────────────────────
    if (!isWindows) {
      // Build image
      await buildImage(repoDir, imageTag, deploymentId);

      // Decrypt env vars
      const rawEnvs = await EnvVar.find({ project: projectId });
      const envVars = { PORT: '3000' };
      for (const e of rawEnvs) envVars[e.key] = decryptValue(e.value);

      // Stop old container
      if (project.containerId) {
        await log('Stopping old container…');
        await stopContainer(project.containerId);
      }

      // Start new container
      const hostPort    = project.port || await getNextFreePort();
      const containerId = await runContainer(imageTag, hostPort, envVars, deploymentId);

      // Nginx + DNS + SSL
      createNginxConfig(project.subdomain, hostPort, false);
      await log(`Nginx configured: ${project.subdomain} → :${hostPort}`);

      if (!project.dnsRecordId) {
        const dnsRecordId = await createSubdomain(project.subdomain);
        if (dnsRecordId) {
          await Project.findByIdAndUpdate(projectId, { dnsRecordId });
          await log('DNS record created.');
        }
        setTimeout(() => {
          const ok = provisionSSL(project.subdomain);
          if (ok) {
            const { upgradeToHTTPS } = require('../services/nginx.service');
            upgradeToHTTPS(project.subdomain, hostPort);
          }
        }, 15_000);
      }

      await Project.findByIdAndUpdate(projectId, {
        containerId,
        port: hostPort,
      });

    } else {
      await log('⚠️  Docker skipped on Windows — will run on Oracle Cloud Linux.');
      await log('✅  Code cloned, stack detected, Dockerfile generated successfully.');
    }

    // ── 4. Mark success ──────────────────────────────────────────────────────
    const finishedAt = new Date();
    const duration   = finishedAt - startedAt;

    await Project.findByIdAndUpdate(projectId, {
      status:        'live',
      lastDeployedAt: finishedAt,
      $inc:          { buildCount: 1 },
    });

    await Deployment.findByIdAndUpdate(deploymentId, {
      status:     'success',
      imageTag,
      finishedAt,
      duration,
    });

    await log(`✅ Deployment successful! Live at: https://${project.subdomain}.${process.env.CLOUDFLARE_DOMAIN}`);

    // Email notification
    if (project.owner?.email) {
      await sendDeployNotification(project.owner.email, {
        projectName: project.name,
        status:      'success',
        url:         `https://${project.subdomain}.${process.env.CLOUDFLARE_DOMAIN}`,
        commitMsg:   deployment.commitMessage,
      });
    }

  } catch (err) {
    await log(`❌ BUILD FAILED: ${err.message}`);

    // AI error diagnosis
    try {
      const fresh   = await Deployment.findById(deploymentId);
      const summary = await analyzeError(fresh.logs.join('\n'), project.stack);
      if (summary) {
        await Deployment.findByIdAndUpdate(deploymentId, { aiErrorSummary: summary });
        await log(`🤖 AI: ${summary}`);
      }
    } catch { await log('(AI diagnosis unavailable)'); }

    await Deployment.findByIdAndUpdate(deploymentId, {
      status:    'failed',
      finishedAt: new Date(),
    });
    await Project.findByIdAndUpdate(projectId, { status: 'failed' });

    // Failure email
    if (project.owner?.email) {
      await sendDeployNotification(project.owner.email, {
        projectName: project.name,
        status:      'failed',
        url:         `${process.env.CLIENT_URL}/projects/${projectId}`,
        commitMsg:   deployment.commitMessage,
      });
    }

    throw err;
  }
});

buildQueue.on('failed', (job, err) => console.error(`Build ${job.id} failed:`, err.message));

module.exports = buildQueue;