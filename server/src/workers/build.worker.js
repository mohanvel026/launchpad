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
const { analyzeError, predictDeploymentHealth, summarizeBuild, auditLeakedSecrets } = require('../services/ai.service');
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

// Detect what port the app actually exposes inside the container
// Priority: 1) User env var PORT, 2) App's own .env file PORT, 3) Stack default
const detectContainerPort = (repoDir, stack, runtimeEnv) => {
  // If user explicitly set PORT in LaunchPad env vars, respect it
  if (runtimeEnv.PORT && runtimeEnv.PORT !== '3000') {
    return parseInt(runtimeEnv.PORT);
  }
  // Check backend/.env or root .env for PORT
  const envFiles = [
    path.join(repoDir, 'backend', '.env'),
    path.join(repoDir, 'server', '.env'),
    path.join(repoDir, '.env'),
    path.join(repoDir, 'backend', '.env.example'),
    path.join(repoDir, '.env.example'),
  ];
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      const match = content.match(/^PORT\s*=\s*(\d+)/m);
      if (match) return parseInt(match[1]);
    }
  }

  // Source Code Port Scanner Fallback (detects hardcoded ports in express/node entrypoints)
  const entryFiles = [
    path.join(repoDir, 'server.js'),
    path.join(repoDir, 'app.js'),
    path.join(repoDir, 'index.js'),
    path.join(repoDir, 'backend', 'server.js'),
    path.join(repoDir, 'backend', 'app.js'),
    path.join(repoDir, 'backend', 'index.js'),
    path.join(repoDir, 'server', 'server.js'),
    path.join(repoDir, 'server', 'app.js'),
    path.join(repoDir, 'server', 'index.js'),
  ];
  for (const file of entryFiles) {
    if (fs.existsSync(file)) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        // Match .listen(5000)
        const listenMatch = content.match(/\.listen\(\s*(\d+)\s*\)/);
        if (listenMatch) return parseInt(listenMatch[1]);
        
        // Match .listen(PORT || 5000) or .listen(process.env.PORT || 5000)
        const listenOrMatch = content.match(/\.listen\(\s*(?:process\.env\.)?PORT\s*\|\|\s*(\d+)\s*\)/i);
        if (listenOrMatch) return parseInt(listenOrMatch[1]);

        // Match const PORT = 5000
        const portConstMatch = content.match(/(?:const|let|var)\s+PORT\s*=\s*(\d+)/i);
        if (portConstMatch) return parseInt(portConstMatch[1]);
      } catch {}
    }
  }

  // Stack defaults — static/react use nginx on 3000, node apps often use 3000 or 5000
  if (stack === 'static' || stack === 'react' || stack === 'next') return 3000;
  if (stack === 'fullstack-split' || stack === 'mern') return 3000;
  return 3000;
};

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

    let rawEnvs = await EnvVar.find({ project: projectId });

    // Zero-Touch Autonomous AI Auto-Config: If project has no environment variables, discover and save them automatically on first deploy!
    if (rawEnvs.length === 0) {
      await log(`🔍 [AI Auto-Config] No environment variables set. Automatically scanning codebase for requirements…`);
      let aggregatedCode = '';
      
      try {
        const scanForEnv = (dir, depth = 0) => {
          if (depth > 3) return;
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            if (fs.statSync(fullPath).isDirectory()) {
              if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
                scanForEnv(fullPath, depth + 1);
              }
            } else if (/\.(js|ts|py|json|config)$/i.test(file)) {
              if (aggregatedCode.length < 10000) {
                aggregatedCode += fs.readFileSync(fullPath, 'utf8').slice(0, 1000);
              }
            }
          }
        };
        
        scanForEnv(repoDir);
        
        const { discoverRequiredEnvVars } = require('../services/ai.service');
        const discovery = await discoverRequiredEnvVars(aggregatedCode, stack);
        
        if (discovery.detectedVars && discovery.detectedVars.length > 0) {
          for (const v of discovery.detectedVars) {
            const defaultValue = v.suggestedValue || v.placeholder || `your_${v.key.toLowerCase()}_placeholder`;
            const encryptedValue = CryptoJS.AES.encrypt(defaultValue, process.env.ENCRYPTION_KEY).toString();
            
            await EnvVar.create({
              project: projectId,
              key: v.key,
              value: encryptedValue,
              isSecret: true
            });
          }
          await log(`   ✅ [AI Auto-Config] Successfully discovered and securely configured ${discovery.detectedVars.length} variables!`);
          
          // Reload newly created variables to continue build seamlessly
          rawEnvs = await EnvVar.find({ project: projectId });
        } else {
          await log(`   ℹ️ [AI Auto-Config] Scan complete: No environment variable references found.`);
        }
      } catch (discoverErr) {
        await log(`   ⚠️ [AI Auto-Config] Automatic configuration skipped: ${discoverErr.message}`);
      }
    }

    const runtimeEnv = { PORT: '3000', NODE_ENV: 'production' };
    for (const e of rawEnvs) {
      try {
        runtimeEnv[e.key] = decryptValue(e.value);
      } catch {}
    }
    const containerPort = detectContainerPort(repoDir, stack, runtimeEnv);

    // ── Pre-flight Leaked Secrets Shield ──
    try {
      let aggregatedCode = '';
      const scanFiles = (dir, depth = 0) => {
        if (depth > 2) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
              scanFiles(fullPath, depth + 1);
            }
          } else if (/\.(js|ts|py|json|env|config|yaml|yml)$/i.test(file)) {
            if (aggregatedCode.length < 15000) {
              aggregatedCode += fs.readFileSync(fullPath, 'utf8').slice(0, 1500);
            }
          }
        }
      };
      
      scanFiles(repoDir);
      
      const leaks = auditLeakedSecrets(aggregatedCode);
      if (leaks.length > 0) {
        await log(`🛑 [SECURITY AUDIT ALERT] Exposed Secrets Detected in repository!`);
        for (const leak of leaks) {
          await log(`   ↳ ⚠️ WARNING: Hardcoded ${leak.type} found (${leak.leakedValue}).`);
        }
        await log(`   💡 SRE Suggestion: Instantly remove this hardcoded secret and save it inside your LaunchPad Dashboard Env panel instead!`);
      } else {
        await log(`✅ [SECURITY AUDIT] Pre-flight secrets check passed. No leaked keys found.`);
      }
    } catch (secErr) {
      console.warn('[Security Shield Check Failed]:', secErr.message);
    }

    // ── PHASE 3: Prepare Docker ──
    await log(`📝 PHASE 3: Generating optimized build instructions…`);
    const dockerfile = generateDockerfile(stack, repoDir, {
      installCommand: project.installCommand,
      buildCommand:   project.buildCommand,
      outputDir:      project.outputDir,
      envVars:        rawEnvs,
      containerPort:  containerPort
    });
    fs.writeFileSync(path.join(repoDir, 'Dockerfile'), dockerfile);
    await log(`   ✅ Dockerfile generated for ${stack.toUpperCase()} environment (Internal Port: ${containerPort}).`);

    // ── AI Pre-flight Health Check ──
    const envVarKeys = rawEnvs.map(e => e.key);
    const health = await predictDeploymentHealth(dockerfile, envVarKeys, stack);
    if (health.willFail && health.confidence >= 70) {
      await log(`   ⚠️  AI Pre-flight Warning (${health.confidence}% confidence): ${health.reason}`);
      await log(`   💡 Suggestion: ${health.suggestion}`);
    }

    // ── PHASE 4/5: Build & Run ──
    const tempEnvFile = path.join(repoDir, '.env');
    
    if (!isWindows) {
      // Build-time args for --build-arg injection
      const buildArgs = {};
      for (const e of rawEnvs) {
        buildArgs[e.key] = decryptValue(e.value);
      }
      // Ensure runtime env PORT reflects what container actually listens on
      runtimeEnv.PORT = String(containerPort);

      // Elite SRE addition: Auto-write a secure build-time .env file so client-side builders (Vite, Next, etc.) can compile constants correctly
      if (rawEnvs.length > 0) {
        await log(`🔐 PHASE 4: Injecting ${rawEnvs.length} encrypted secrets into temporary .env…`);
        try {
          let envContent = '';
          for (const [k, v] of Object.entries(buildArgs)) {
            envContent += `${k}="${v.replace(/"/g, '\\"')}"\n`;
          }
          fs.writeFileSync(tempEnvFile, envContent, 'utf-8');
        } catch (envErr) {
          await log(`   ⚠️ Failed to generate build-time .env file: ${envErr.message}`);
        }
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
        await log(`   ❌ Build failed! Analyzing logs…`);
        // Use structured AI analysis
        const diagnosis = await analyzeError(stderr, stack);
        await log(`   🤖 AI Diagnosis: ${diagnosis.summary}`);
        await log(`   🔍 Root Cause: ${diagnosis.cause}`);
        await log(`   🛠️  Fix: ${diagnosis.fix}`);
        if (diagnosis.commands?.length) {
          await log(`   💻 Suggested commands:\n${diagnosis.commands.map(c => '      $ ' + c).join('\n')}`);
        }
        throw new Error('Docker build failure');
      } finally {
        // Clean up temporary .env to maintain total secret security on the server
        if (fs.existsSync(tempEnvFile)) {
          try {
            fs.unlinkSync(tempEnvFile);
            await log(`   🧹 Cleaned up temporary build-time .env file successfully.`);
          } catch (unlinkErr) {
            console.warn(`[Build Worker] Failed to unlink temp env file: ${unlinkErr.message}`);
          }
        }
      }

      // Use a stable container name per project so re-deploys cleanly replace the old one
      const containerName = `lp-${projectId.slice(-8)}`;

      // Stop old container whether it's tracked by ID or by name
      await log('🔄 PHASE 6: Replacing previous instance…');
      if (project.containerId) safeExec(`docker stop ${project.containerId} 2>/dev/null`);
      safeExec(`docker stop ${containerName} 2>/dev/null`);
      safeExec(`docker rm -f ${containerName} 2>/dev/null`);
      if (project.containerId) safeExec(`docker rm -f ${project.containerId} 2>/dev/null`);

      // Verify EXPOSE port from the built image matches what we detected
      // containerPort is already computed above — this step reconciles any mismatch
      let finalContainerPort = containerPort;
      try {
        const exposedRaw = execSync(
          `docker inspect --format='{{json .Config.ExposedPorts}}' ${imageTag}`,
          { stdio: 'pipe' }
        ).toString().trim();
        const exposed = JSON.parse(exposedRaw);
        const firstPort = Object.keys(exposed || {})[0]; // e.g. "5000/tcp"
        if (firstPort) {
          const imagePort = parseInt(firstPort.split('/')[0]);
          // The Dockerfile EXPOSE port is the ground truth — use it
          if (imagePort) finalContainerPort = imagePort;
        }
      } catch { /* keep detected default */ }

      const hostPort = project.port || await getNextFreePort();
      await log(`   ↳ Container port ${finalContainerPort} → Host port ${hostPort}`);

      // Build docker run with all env vars
      let runCmd = `docker run -d --restart unless-stopped -p ${hostPort}:${finalContainerPort}`;
      for (const [k, v] of Object.entries(runtimeEnv)) {
        const safe = v.replace(/"/g, '\\"');
        runCmd += ` -e "${k}=${safe}"`;
      }
      // Ensure PORT env var matches what the container actually listens on
      runCmd += ` -e "PORT=${finalContainerPort}"`;
      runCmd += ` --name ${containerName} ${imageTag}`;

      let containerId;
      try {
        containerId = execSync(runCmd, { stdio: 'pipe' }).toString().trim();
        await log(`   ✅ Container started (ID: ${containerId.slice(0, 12)}) — verifying...`);

        // ── Real HTTP Health Check with retries ──
        // Give the app time to initialize (DB connections, env setup, etc.)
        const maxAttempts = 8;
        let appHealthy = false;
        let lastStatus = 'unknown';

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          await new Promise(r => setTimeout(r, attempt === 1 ? 5000 : 3000));

          // First check container is still running (catches immediate exits)
          const stateRaw = safeExec(`docker inspect --format '{{.State.Status}}' ${containerId}`);
          lastStatus = stateRaw ? stateRaw.toString().trim() : 'unknown';

          if (lastStatus !== 'running') break; // Container crashed — stop retrying

          // Then do a real HTTP probe against the host port
          const probe = safeExec(`curl -sf --max-time 4 http://127.0.0.1:${hostPort}/`);
          if (probe !== null) {
            appHealthy = true;
            break;
          }

          await log(`   ⏳ Waiting for app to be ready... (attempt ${attempt}/${maxAttempts})`);
        }

        if (!appHealthy) {
          // Collect container logs for diagnosis
          const crashLogs = safeExec(`docker logs --tail 50 ${containerId} 2>&1`) || '';
          const logText = crashLogs.toString().slice(0, 1200);

          if (lastStatus !== 'running') {
            await log(`   ❌ Container exited unexpectedly (status: ${lastStatus})`);
          } else {
            await log(`   ❌ App did not respond after ${maxAttempts} attempts — likely crashing inside container`);
          }
          await log(`   📋 Container logs:\n${logText}`);

          // AI diagnosis on container logs
          const diagnosis = await analyzeError(logText, stack);
          await log(`   🤖 AI Diagnosis: ${diagnosis.summary}`);
          await log(`   🔍 Root Cause: ${diagnosis.cause}`);
          await log(`   🛠️  Fix: ${diagnosis.fix}`);
          if (diagnosis.commands?.length) {
            await log(`   💻 Suggested commands:\n${diagnosis.commands.map(c => '      $ ' + c).join('\n')}`);
          }

          safeExec(`docker rm -f ${containerId}`);
          throw new Error('App health check failed after container started');
        }

        await log(`   ✅ Instance online and healthy (ID: ${containerId.slice(0, 12)})`);
      } catch (runErr) {
        if (runErr.message.includes('health check failed') || runErr.message.includes('exited')) throw runErr;
        await log(`   ❌ docker run failed: ${runErr.message}`);
        throw new Error('Runtime execution failure');
      }

      await log('🌐 PHASE 7: Updating routing engine…');
      // Write nginx config for this subdomain and custom domain if present
      createNginxConfig(project.subdomain, hostPort, false, project.customDomain);

      const { invalidateProjectCache } = require('../middleware/projectProxy.middleware');
      invalidateProjectCache(project.subdomain);
      await log(`   ✅ Internal proxy updated. Traffic routed to ${liveUrl}`);

      const DOMAIN = (process.env.CLOUDFLARE_DOMAIN || '129.159.22.142.nip.io').toLowerCase();
      const isNipIo = DOMAIN.includes('nip.io');

      if (!project.dnsRecordId && !isNipIo) {
        const dnsRecordId = await createSubdomain(project.subdomain);
        if (dnsRecordId) {
          await Project.findByIdAndUpdate(projectId, { dnsRecordId });
          await log('   ✅ DNS records propagated to Edge Network.');
        }

        setTimeout(async () => {
          const ok = provisionSSL(project.subdomain, project.customDomain);
          if (ok) {
            const { upgradeToHTTPS } = require('../services/nginx.service');
            upgradeToHTTPS(project.subdomain, hostPort, project.customDomain);
            await log('   🔒 SSL certificate provisioned. HTTP → HTTPS upgrade complete.');
          }
        }, 15_000);
      } else if (isNipIo) {
        await log('   ℹ️ nip.io domain detected. Skipping DNS and SSL provisioning.');
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