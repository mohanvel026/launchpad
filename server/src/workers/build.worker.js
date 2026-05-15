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
    const line = `[${new Date().toISOString()}] ${msg}`;
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
    // ── STEP 1: Clone / Pull ───────────────────────────────────────────────
    await log(`📦 Fetching ${project.repoFullName}@${project.branch}…`);

    if (fs.existsSync(repoDir)) {
      // Try to pull latest — if it fails, nuke and re-clone
      const pulled = safeExec(
        `git -C "${repoDir}" remote set-url origin ${cloneUrl} && ` +
        `git -C "${repoDir}" fetch --all && ` +
        `git -C "${repoDir}" reset --hard origin/${project.branch}`
      );
      if (!pulled) {
        await log('   ↳ Pull failed — doing fresh clone…');
        fs.rmSync(repoDir, { recursive: true, force: true });
        execSync(`git clone --branch ${project.branch} --depth 1 "${cloneUrl}" "${repoDir}"`, { stdio: 'pipe' });
      }
    } else {
      execSync(`git clone --branch ${project.branch} --depth 1 "${cloneUrl}" "${repoDir}"`, { stdio: 'pipe' });
    }
    await log('✅ Source code ready.');

    // ── STEP 2: Detect Stack ───────────────────────────────────────────────
    // Respect user-selected framework if set, otherwise auto-detect
    let stack = project.framework || detectStack(repoDir);
    await log(`🔍 Stack detected: ${stack.toUpperCase()}`);
    await Project.findByIdAndUpdate(projectId, { stack });

    // ── STEP 3: Generate Dockerfile ────────────────────────────────────────
    const dockerfile = generateDockerfile(stack, repoDir);
    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), dockerfile);
    await log('📝 Dockerfile generated for ' + stack + ' project.');

    // ── STEP 4: Docker Build + Run (Linux only) ────────────────────────────
    if (!isWindows) {

      // Decrypt all project env vars
      const rawEnvs = await EnvVar.find({ project: projectId });
      const runtimeEnv = { PORT: '3000', NODE_ENV: 'production' };
      const buildArgs  = {};

      for (const e of rawEnvs) {
        const val = decryptValue(e.value);
        runtimeEnv[e.key] = val;
        buildArgs[e.key]  = val; // pass ALL vars as build args too
      }

      if (rawEnvs.length > 0) {
        await log(`🔐 ${rawEnvs.length} environment variable(s) loaded.`);
      } else {
        await log(`ℹ️  No env vars set. Add them in "Env Variables" tab → redeploy.`);
      }

      // Build Docker image
      await log('🔨 Building Docker image… (may take 1–3 min on first build)');

      let buildCmd = `docker build --no-cache`;
      // Inject every env var as a build-arg
      for (const [k, v] of Object.entries(buildArgs)) {
        const safe = v.replace(/"/g, '\\"');
        buildCmd += ` --build-arg ${k}="${safe}"`;
      }
      buildCmd += ` -t ${imageTag} "${repoDir}"`;

      try {
        execSync(buildCmd, { stdio: 'pipe' });
        await log('✅ Docker image built successfully.');
      } catch (buildErr) {
        const stderr = buildErr.stderr?.toString('utf-8') || buildErr.message || '';
        // Surface the actual error lines to the user
        const errorLines = stderr
          .split('\n')
          .filter(l => l.toLowerCase().includes('error') || l.includes('ERR') || l.includes('npm warn'))
          .slice(0, 15)
          .join('\n');
        await log(`❌ Build failed:\n${errorLines || stderr.slice(0, 600)}`);
        await log(`💡 Tip: Check the "Env Variables" tab — your app may be missing required vars.`);
        throw new Error('Docker build failed');
      }

      // Remove old container gracefully
      if (project.containerId) {
        await log('🔄 Removing old container…');
        safeExec(`docker stop ${project.containerId}`);
        safeExec(`docker rm   ${project.containerId}`);
      }

      // Run new container
      const hostPort = project.port || await getNextFreePort();
      await log(`🚀 Starting container on port ${hostPort}…`);

      let runCmd = `docker run -d --restart unless-stopped -p ${hostPort}:3000`;
      for (const [k, v] of Object.entries(runtimeEnv)) {
        const safe = v.replace(/"/g, '\\"');
        runCmd += ` -e ${k}="${safe}"`;
      }
      runCmd += ` --name lp-${deploymentId.slice(-8)} ${imageTag}`;

      let containerId;
      try {
        containerId = execSync(runCmd, { stdio: 'pipe' }).toString().trim();
        await log(`✅ Container running: ${containerId.slice(0, 12)}`);
      } catch (runErr) {
        await log(`❌ Container start failed: ${runErr.message}`);
        throw new Error('Container failed to start');
      }

      // Write Nginx reverse proxy config
      createNginxConfig(project.subdomain, hostPort, false);
      await log(`🌐 Domain live: ${liveUrl}`);

      // Cloudflare DNS (optional)
      if (!project.dnsRecordId) {
        const dnsRecordId = await createSubdomain(project.subdomain);
        if (dnsRecordId) {
          await Project.findByIdAndUpdate(projectId, { dnsRecordId });
          await log('✅ DNS record created via Cloudflare CDN.');
        }

        // SSL provisioning (runs in background after DNS propagates)
        setTimeout(async () => {
          const ok = provisionSSL(project.subdomain);
          if (ok) {
            const { upgradeToHTTPS } = require('../services/nginx.service');
            upgradeToHTTPS(project.subdomain, hostPort);
            await log('🔒 HTTPS enabled! Certificate provisioned.');
          }
        }, 20_000);
      }

      await Project.findByIdAndUpdate(projectId, { containerId, port: hostPort });

      // Clean up old dangling images to save disk space
      safeExec('docker image prune -f');

    } else {
      await log('⚠️  Docker skipped on Windows — running in dev mode.');
      await log('✅  Code cloned and Dockerfile generated. Push to server to run.');
    }

    // ── STEP 5: Mark Success ───────────────────────────────────────────────
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

    await log(`🎉 Deployed in ${(duration / 1000).toFixed(1)}s!`);
    await log(`🔗 Live at: ${liveUrl}`);

    // Email notification
    if (project.owner?.email) {
      sendDeployNotification(project.owner.email, {
        projectName: project.name, status: 'success',
        url: liveUrl, commitMsg: deployment.commitMessage,
      }).catch(() => {});
    }

  } catch (err) {
    await log(`\n💥 DEPLOYMENT FAILED: ${err.message}`);

    // AI diagnosis
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