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
const { invalidateProjectCache }                  = require('../middleware/projectProxy.middleware');

// ─── Queue Setup ──────────────────────────────────────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const decryptValue = (encrypted) => {
  try {
    const bytes = CryptoJS.AES.decrypt(encrypted, process.env.ENCRYPTION_KEY);
    return bytes.toString(CryptoJS.enc.Utf8) || encrypted;
  } catch { return encrypted; }
};

const safeExec = (cmd, opts = {}) => {
  try {
    return execSync(cmd, { stdio: 'pipe', ...opts });
  } catch (e) {
    return null;
  }
};

const isWindows = process.platform === 'win32';

// ─── Build Process ────────────────────────────────────────────────────────────
buildQueue.process(async (job) => {
  const { deploymentId, projectId } = job.data;

  const deployment = await Deployment.findById(deploymentId);
  const project    = await Project.findById(projectId)
    .populate('owner', 'email username githubAccessToken');

  if (!deployment || !project) throw new Error('Deployment or project not found');

  const domain = process.env.CLOUDFLARE_DOMAIN || '129.159.22.142.nip.io';
  const liveUrl = `http://${project.subdomain}.${domain}`;

  // ── Logger ────────────────────────────────────────────────────────────────
  const log = async (msg) => {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    emitLog(deploymentId, line);
    await Deployment.findByIdAndUpdate(deploymentId, { $push: { logs: line } });
  };

  await deployment.updateOne({ status: 'building', startedAt: new Date() });
  await Project.findByIdAndUpdate(projectId, { status: 'building' });

  const repoDir   = path.join(REPOS_DIR, projectId);
  const imageTag  = `launchpad-${projectId}:${deploymentId}`;
  const startedAt = new Date();

  // Inject GitHub token for private repos
  let cloneUrl = project.repoUrl;
  if (project.owner?.githubAccessToken) {
    cloneUrl = cloneUrl.replace('https://', `https://${project.owner.githubAccessToken}@`);
  }

  try {
    // ── PHASE 1: Fetch Source ──
    await log(`📦 PHASE 1: Fetching source code…`);
    await log(`   ↳ Target: ${project.repoFullName}@${project.branch}`);

    if (fs.existsSync(repoDir)) {
      const pulled = safeExec(
        `git -C "${repoDir}" remote set-url origin ${cloneUrl} && ` +
        `git -C "${repoDir}" fetch --all && ` +
        `git -C "${repoDir}" reset --hard origin/${project.branch}`
      );
      if (!pulled) {
        await log('   ⚠️ Local cache invalid. Performing fresh clone…');
        fs.rmSync(repoDir, { recursive: true, force: true });
        execSync(`git clone --branch ${project.branch} --depth 1 "${cloneUrl}" "${repoDir}"`, { stdio: 'pipe' });
      } else {
        await log('   ✅ Repository synchronized with latest commits.');
      }
    } else {
      execSync(`git clone --branch ${project.branch} --depth 1 "${cloneUrl}" "${repoDir}"`, { stdio: 'pipe' });
      await log('   ✅ Fresh clone completed.');
    }

    // ── PHASE 2: Analyze ──
    await log(`🔍 PHASE 2: Analyzing project architecture…`);
    const analysis = detectStack(repoDir);
    const stack = (project.framework && project.framework !== 'auto') 
      ? project.framework 
      : (typeof analysis === 'string' ? analysis : analysis.type);
    
    await log(`   ↳ Detected Stack: ${stack.toUpperCase()}`);
    await Project.findByIdAndUpdate(projectId, { stack });

    // ── PHASE 3: Prepare Docker ──
    await log(`📝 PHASE 3: Generating optimized build instructions…`);
    const dockerfile = generateDockerfile(stack, repoDir, {
      installCommand: project.installCommand,
      buildCommand:   project.buildCommand,
      outputDir:      project.outputDir,
      envVars:        rawEnvs
    });
    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), dockerfile);
    await log(`   ✅ Dockerfile generated for ${stack.toUpperCase()} environment.`);

    // ── PHASE 4/5: Build & Run ──
    if (!isWindows) {
      const rawEnvs = await EnvVar.find({ project: projectId });
      const runtimeEnv = { PORT: '3000', NODE_ENV: 'production' };
      const buildArgs  = {};

      for (const e of rawEnvs) {
        const val = decryptValue(e.value);
        runtimeEnv[e.key] = val;
        buildArgs[e.key]  = val;
      }

      if (rawEnvs.length > 0) {
        await log(`🔐 PHASE 4: Injecting ${rawEnvs.length} encrypted secrets…`);
      } else {
        await log(`ℹ️ PHASE 4: No environment variables detected.`);
      }

      await log('🔨 PHASE 5: Building container image (this may take a few minutes)…');
      
      let buildCmd = `docker build --no-cache`;
      for (const [k, v] of Object.entries(buildArgs)) {
        const safe = v.replace(/"/g, '\\"');
        buildCmd += ` --build-arg ${k}="${safe}"`;
      }
      buildCmd += ` -t ${imageTag} "${repoDir}"`;

      try {
        execSync(buildCmd, { stdio: 'pipe' });
        await log('   ✅ Build successful. Image tagged and ready for deployment.');
      } catch (buildErr) {
        const stderr = buildErr.stderr?.toString('utf-8') || buildErr.message || '';
        const errorLines = stderr
          .split('\n')
          .filter(l => l.toLowerCase().includes('error') || l.includes('ERR'))
          .slice(0, 15)
          .join('\n');
        await log(`   ❌ Build failed! Analyzing logs…\n${errorLines}`);
        throw new Error('Docker build failure');
      }

      // Use a stable container name per project so re-deploys cleanly replace the old one
      const containerName = `lp-${projectId.slice(-8)}`;

      // Stop old container whether it's tracked by ID or by name
      await log('🔄 PHASE 6: Replacing previous instance…');
      if (project.containerId) safeExec(`docker stop ${project.containerId} 2>/dev/null`);
      safeExec(`docker stop ${containerName} 2>/dev/null`);
      safeExec(`docker rm -f ${containerName} 2>/dev/null`);
      if (project.containerId) safeExec(`docker rm -f ${project.containerId} 2>/dev/null`);

      // Detect the EXPOSE port from the built image (so Node apps on 5000 work correctly)
      let containerPort = 3000;
      try {
        const exposedRaw = execSync(
          `docker inspect --format='{{json .Config.ExposedPorts}}' ${imageTag}`,
          { stdio: 'pipe' }
        ).toString().trim();
        const exposed = JSON.parse(exposedRaw);
        const firstPort = Object.keys(exposed || {})[0]; // e.g. "3000/tcp"
        if (firstPort) containerPort = parseInt(firstPort.split('/')[0]) || 3000;
      } catch { /* keep default 3000 */ }

      const hostPort = project.port || await getNextFreePort();
      let runCmd = `docker run -d --restart unless-stopped -p ${hostPort}:${containerPort}`;
      for (const [k, v] of Object.entries(runtimeEnv)) {
        const safe = v.replace(/"/g, '\\"');
        runCmd += ` -e ${k}="${safe}"`;
      }
      runCmd += ` --name ${containerName} ${imageTag}`;
      await log(`   ↳ Mapping host:${hostPort} → container:${containerPort}`);

      let containerId;
      try {
        containerId = execSync(runCmd, { stdio: 'pipe' }).toString().trim();
        await log(`   ✅ Container started (ID: ${containerId.slice(0, 12)}) — verifying...`);

        // Wait 4 seconds then confirm container is still running (catches immediate crashes)
        await new Promise(r => setTimeout(r, 4000));
        const state = safeExec(`docker inspect --format '{{.State.Status}}' ${containerId}`);
        const status = state ? state.toString().trim() : 'unknown';

        if (status !== 'running') {
          // Grab container logs to help debug
          const crashLogs = safeExec(`docker logs --tail 30 ${containerId}`) || '';
          await log(`   ❌ Container exited immediately (status: ${status})`);
          await log(`   📋 Container logs:\n${crashLogs.toString().slice(0, 800)}`);
          safeExec(`docker rm -f ${containerId}`);
          throw new Error(`Container exited with status: ${status}`);
        }

        await log(`   ✅ Instance online and healthy (ID: ${containerId.slice(0, 12)})`);
      } catch (runErr) {
        if (runErr.message.startsWith('Container exited')) throw runErr;
        await log(`   ❌ docker run failed: ${runErr.message}`);
        throw new Error('Runtime execution failure');
      }

      await log('🌐 PHASE 7: Updating routing engine…');
      // No longer need to write host-level nginx configs for every subdomain.
      // The internal projectProxyMiddleware handles this automatically via the wildcard rule.
      await log(`   ✅ Internal proxy updated. Traffic routed to ${liveUrl}`);

      if (!project.dnsRecordId) {
        const dnsRecordId = await createSubdomain(project.subdomain);
        if (dnsRecordId) {
          await Project.findByIdAndUpdate(projectId, { dnsRecordId });
          await log('   ✅ DNS records propagated to Edge Network.');
        }

        setTimeout(async () => {
          const ok = provisionSSL(project.subdomain);
          if (ok) {
            const { upgradeToHTTPS } = require('../services/nginx.service');
            upgradeToHTTPS(project.subdomain, hostPort);
            await log('   🔒 SSL certificate provisioned. HTTP → HTTPS upgrade complete.');
          }
        }, 15_000);
      }

      await Project.findByIdAndUpdate(projectId, { containerId, port: hostPort });
      safeExec('docker image prune -f');

    } else {
      await log('⚠️ DEVELOPMENT MODE: Local build successful.');
      await log('   ↳ Containerization skipped on Windows host.');
    }

    // ── FINALIZATION ──
    const finishedAt = new Date();
    const duration   = finishedAt - startedAt;

    await Project.findByIdAndUpdate(projectId, {
      status:         'live',
      lastDeployedAt: finishedAt,
      $inc:           { buildCount: 1 },
    });

    await Deployment.findByIdAndUpdate(deploymentId, {
      status: 'success', imageTag, finishedAt, duration,
    });

    await log(`✨ ALL PHASES COMPLETE! Deployed in ${(duration / 1000).toFixed(1)}s.`);
    await log(`🚀 Project is now live at: ${liveUrl}`);

    // Flush proxy cache so the new port is used immediately
    invalidateProjectCache(project.subdomain);

    if (project.owner?.email) {
      sendDeployNotification(project.owner.email, {
        projectName: project.name, status: 'success',
        url: liveUrl, commitMsg: deployment.commitMessage,
      }).catch(() => {});
    }

  } catch (err) {
    await log(`\n🛑 DEPLOYMENT ABORTED: ${err.message}`);

    try {
      const fresh   = await Deployment.findById(deploymentId);
      const summary = await analyzeError(fresh.logs.join('\n'), project.stack);
      if (summary) {
        await Deployment.findByIdAndUpdate(deploymentId, { aiErrorSummary: summary });
        await log(`🤖 AI Diagnosis: ${summary}`);
      }
    } catch { /* AI unavailable */ }

    await Deployment.findByIdAndUpdate(deploymentId, {
      status: 'failed', finishedAt: new Date(),
    });
    await Project.findByIdAndUpdate(projectId, { status: 'failed' });

    if (project.owner?.email) {
      sendDeployNotification(project.owner.email, {
        projectName: project.name, status: 'failed',
        url: `${process.env.CLIENT_URL}/projects/${projectId}`,
        commitMsg: deployment.commitMessage,
      }).catch(() => {});
    }

    throw err;
  }
});

buildQueue.on('failed', (job, err) =>
  console.error(`[BuildQueue] Job ${job.id} failed:`, err.message)
);

module.exports = buildQueue;