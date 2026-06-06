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
const { getNextFreePort, isPortFree }              = require('../services/portAllocator.service');
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
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 2,
  }
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

const util         = require('util');
const execAsync    = util.promisify(require('child_process').exec);

const safeExec = (cmd, opts = {}) => {
  try {
    return execSync(cmd, { stdio: 'pipe', ...opts });
  } catch (e) {
    return null;
  }
};

const isWindows = process.platform === 'win32';

const pushAuditStep = async (deploymentId, step, status, details) => {
  try {
    const mongoose = require('mongoose');
    const Deployment = mongoose.model('Deployment');
    await Deployment.findByIdAndUpdate(deploymentId, {
      $push: {
        autoHealAuditTrail: { step, status, details, timestamp: new Date() }
      }
    });
  } catch (err) {
    console.error('[Auto-Heal Audit] Failed to record step:', err.message);
  }
};

// ─── Local Pattern-Based Error Diagnosis (no AI needed) ────────────────────────
// Provides instant, useful diagnosis even when the AI service is unavailable.
const localDiagnoseError = (output = '', stack = 'unknown') => {
  const o = output.toLowerCase();

  // npm / yarn install failures
  if (/npm err!|yarn error|enoent.*package\.json|cannot find module/i.test(output)) {
    return {
      cause: 'Dependency installation failed. A required npm package is missing or package.json has an error.',
      fix: 'Check your package.json for typos or missing dependencies. Run `npm install` locally to reproduce the error.',
      commands: ['npm install', 'npm ls --depth=0'],
    };
  }

  // Build tool failure (vite, webpack, tsc, etc.)
  if (/vite.*error|webpack.*error|tsc.*error|build.*failed|error ts\d+/i.test(output)) {
    return {
      cause: 'Build tool compilation failed. There are TypeScript errors, import errors, or missing environment variables in the source code.',
      fix: 'Run `npm run build` locally to see the exact error. Check for missing VITE_* or REACT_APP_* env vars in your .env file.',
      commands: ['npm run build', 'npx tsc --noEmit'],
    };
  }

  // Missing environment variable
  if (/process\.env\.|env.*undefined|missing.*env|required.*variable/i.test(output)) {
    return {
      cause: 'A required environment variable is missing at build/runtime.',
      fix: 'Go to the Environment tab in your LaunchPad project and add the missing variable(s), then redeploy.',
      commands: [],
    };
  }

  // Dockerfile syntax / COPY errors
  if (/copy failed|no such file or directory|dockerfile.*error|syntax error/i.test(output)) {
    return {
      cause: 'Dockerfile error — a file or directory referenced in the Dockerfile does not exist in your repository.',
      fix: 'Make sure all paths in your Dockerfile COPY commands exist in the repo. Check for case-sensitivity issues on Linux.',
      commands: ['ls -la', 'git status'],
    };
  }

  // Port / network
  if (/address already in use|eaddrinuse|port.*conflict/i.test(output)) {
    return {
      cause: 'Port conflict — another container or process is already using the target port.',
      fix: 'Delete and redeploy the project to get a fresh port allocation.',
      commands: [],
    };
  }

  // Out of disk / memory
  if (/no space left|out of memory|killed|oom/i.test(output)) {
    return {
      cause: 'Server ran out of disk space or memory during the build.',
      fix: 'Contact support or free up server resources. Try deleting unused projects to reclaim disk space.',
      commands: ['docker system prune -f'],
    };
  }

  // Python
  if (/modulenotfounderror|importerror|pip install/i.test(output)) {
    return {
      cause: 'Python dependency missing. A required package is not in requirements.txt.',
      fix: 'Add the missing package to requirements.txt and push again.',
      commands: ['pip install -r requirements.txt'],
    };
  }

  // Generic fallback — still useful
  return {
    cause: `Docker build for ${stack.toUpperCase()} project failed. See the raw output above for the exact error line.`,
    fix: 'Look for lines starting with "ERROR" or "npm ERR!" in the raw output above. Fix the issue locally, push your changes, and redeploy.',
    commands: ['npm install', 'npm run build'],
  };
};

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
buildQueue.process(1, async (job) => {
  const { deploymentId, projectId } = job.data;

  const deployment = await Deployment.findById(deploymentId);
  const project    = await Project.findById(projectId)
    .populate('owner', 'email username githubAccessToken');

  if (!deployment || !project) throw new Error('Deployment or project not found');

  const domain = process.env.CLOUDFLARE_DOMAIN || 'launchlive.in';
  const liveUrl = `https://${project.subdomain}.${domain}`;

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
    // ── PRE-FLIGHT: Disk Space Check ──────────────────────────────────────────
    if (!isWindows) {
      try {
        const dfOut = execSync(`df -BG "${REPOS_DIR}" | tail -1`, { stdio: 'pipe' }).toString();
        const available = parseInt(dfOut.split(/\s+/)[3]) || 999;
        if (available < 2) {
          const pruneMsg = 'Server disk is nearly full. Running Docker cleanup to free space...';
          await log(`⚠️  ${pruneMsg}`);
          try { execSync('docker system prune -f --volumes', { stdio: 'pipe', timeout: 30000 }); } catch {}
          await log('   ✅ Docker cleanup done. Retrying build...');
        }
      } catch {}
    }

    // ── PHASE 1: Fetch Source ──
    await log(`📦 PHASE 1: Fetching source code…`);
    await log(`   ↳ Target: ${project.repoFullName}@${project.branch}`);

    if (fs.existsSync(repoDir)) {
      try {
        await execAsync(
          `git -C "${repoDir}" remote set-url origin ${cloneUrl} && ` +
          `git -C "${repoDir}" fetch origin ${project.branch} --depth 1 && ` +
          `git -C "${repoDir}" reset --hard FETCH_HEAD`
        );
        await log('   ✅ Repository synchronized with latest commits.');
      } catch (pullErr) {
        await log('   ⚠️ Local cache invalid. Performing fresh clone…');
        fs.rmSync(repoDir, { recursive: true, force: true });
        await execAsync(`git clone --branch ${project.branch} --depth 1 "${cloneUrl}" "${repoDir}"`);
      }
    } else {
      await execAsync(`git clone --branch ${project.branch} --depth 1 "${cloneUrl}" "${repoDir}"`);
      await log('   ✅ Fresh clone completed.');
    }

    // ── PHASE 2: Analyze ──
    await log(`🔍 PHASE 2: Analyzing project architecture…`);
    let stack = project.framework;
    if (!stack || stack === 'auto') {
      const { detectStackWithAI } = require('../services/ai.service');
      const files = fs.readdirSync(repoDir).slice(0, 50);
      let pkg = null;
      if (fs.existsSync(path.join(repoDir, 'package.json'))) {
        try { pkg = JSON.parse(fs.readFileSync(path.join(repoDir, 'package.json'), 'utf8')); } catch(e){}
      }
      stack = await detectStackWithAI(files, pkg);
      if (stack === 'unknown') stack = detectStack(repoDir); // Fallback to local static analysis
    }
    
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
            } else if (/\.(js|ts|py|json|config|yaml|yml)$/i.test(file) || file.includes('.env')) {
              if (aggregatedCode.length < 25000) {
                aggregatedCode += fs.readFileSync(fullPath, 'utf8').slice(0, 2000) + '\n';
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
      
      // ── Stream docker build output live, line-by-line ──────────────────────
      // buildArgs is already defined above in Phase 4 — reuse it here
      const buildArgParts = [];
      for (const [k, v] of Object.entries(buildArgs)) {
        const safe = v.replace(/"/g, '\\"');
        buildArgParts.push('--build-arg', `${k}=${safe}`);
      }

      let dockerBuildFailed = false;
      let dockerBuildOutput = [];

      await new Promise((resolve, reject) => {
        const { spawn } = require('child_process');
        const buildProc = spawn(
          'docker',
          ['build', '--progress=plain', ...buildArgParts, '-t', imageTag, repoDir],
          {
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, DOCKER_BUILDKIT: '1' }
          }
        );

        const handleLine = async (line) => {
          line = line.trimEnd();
          if (!line) return;
          // Filter extremely noisy docker layer download lines
          if (/^(#\d+)? (Downloading|Extracting|Pull complete|Already exists|Layer already)/i.test(line)) return;
          dockerBuildOutput.push(line);
          await log(`   ${line}`);
        };

        let stdoutBuf = '';
        buildProc.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString();
          const lines = stdoutBuf.split('\n');
          stdoutBuf = lines.pop();
          lines.forEach(l => handleLine(l).catch(() => {}));
        });

        let stderrBuf = '';
        buildProc.stderr.on('data', (chunk) => {
          stderrBuf += chunk.toString();
          const lines = stderrBuf.split('\n');
          stderrBuf = lines.pop();
          lines.forEach(l => handleLine(l).catch(() => {}));
        });

        buildProc.on('close', (code) => {
          if (stdoutBuf.trim()) handleLine(stdoutBuf).catch(() => {});
          if (stderrBuf.trim()) handleLine(stderrBuf).catch(() => {});
          if (code === 0) {
            resolve();
          } else {
            dockerBuildFailed = true;
            reject(new Error(`docker build exited with code ${code}`));
          }
        });

        buildProc.on('error', (err) => reject(err));
      }).then(async () => {
        await log('   ✅ Build successful. Image tagged and ready for deployment.');
      }).catch(async (buildErr) => {
        // ── Always show the raw error output FIRST so users see what went wrong ──
        await log(`   ❌ Build failed! (${buildErr.message})`);
        await log('   ─── RAW BUILD ERROR OUTPUT ─────────────────────────────────');
        // Show the last 30 lines where the error usually appears
        const errorLines = dockerBuildOutput.slice(-30);
        for (const line of errorLines) {
          if (!line.startsWith('   ')) await log(`   ${line}`);
        }
        await log('   ────────────────────────────────────────────────────────────');

        // ── Local pattern-based diagnosis (no AI needed) ───────────────────────
        const fullOutput = dockerBuildOutput.join('\n');
        const localDiagnosis = localDiagnoseError(fullOutput, stack);
        await log(`   🔍 Detected Issue: ${localDiagnosis.cause}`);
        await log(`   🛠️  Quick Fix: ${localDiagnosis.fix}`);
        if (localDiagnosis.commands.length) {
          await log(`   💻 Suggested commands:`);
          for (const cmd of localDiagnosis.commands) await log(`      $ ${cmd}`);
        }

        // ── Try AI analysis as an enhancement (non-blocking) ──────────────────
        try {
          const diagnosis = await analyzeError(fullOutput, stack);
          if (diagnosis && diagnosis.summary && !diagnosis.summary.includes('unavailable')) {
            await log(`   🤖 AI Root Cause: ${diagnosis.summary}`);
            await log(`   🤖 AI Fix: ${diagnosis.fix}`);
            if (diagnosis.commands?.length) {
              await log(`   💻 AI Suggested commands:`);
              for (const cmd of diagnosis.commands) await log(`      $ ${cmd}`);
            }
          }
        } catch { /* AI unavailable — local diagnosis above is sufficient */ }

        throw new Error('Docker build failure');
      }).finally(async () => {
        // Clean up temporary .env to maintain total secret security on the server
        if (fs.existsSync(tempEnvFile)) {
          try {
            fs.unlinkSync(tempEnvFile);
            await log(`   🧹 Cleaned up temporary build-time .env file successfully.`);
          } catch (unlinkErr) {
            console.warn(`[Build Worker] Failed to unlink temp env file: ${unlinkErr.message}`);
          }
        }
      });

      // Use a stable container name per project so re-deploys cleanly replace the old one
      const containerName = `lp-${projectId.slice(-8)}`;

      // Stop old container whether it's tracked by ID or by name
      await log('🔄 PHASE 6: Replacing previous instance…');
      if (project.containerId) {
        try { await execAsync(`docker stop ${project.containerId}`); } catch(e) {}
      }
      try { await execAsync(`docker stop ${containerName}`); } catch(e) {}
      try { await execAsync(`docker rm -f ${containerName}`); } catch(e) {}
      if (project.containerId) {
        try { await execAsync(`docker rm -f ${project.containerId}`); } catch(e) {}
      }

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

      let hostPort = project.port;
      if (!hostPort || !(await isPortFree(hostPort))) {
        const oldPort = hostPort;
        hostPort = await getNextFreePort();
        await Project.findByIdAndUpdate(projectId, { port: hostPort });
        if (oldPort) {
          await log(`   ⚠️ Port ${oldPort} was already allocated. Dynamically re-allocated free port: ${hostPort}`);
        }
      }
      await log(`   ↳ Container port ${finalContainerPort} → Host port ${hostPort}`);

      // Build docker run with all env vars and resource limits
      const cpu = project.cpuLimit || 0.5;
      const ram = project.ramLimitMB || 512;
      let runCmd = `docker run -d --restart unless-stopped -p ${hostPort}:${finalContainerPort} --cpus="${cpu}" --memory="${ram}m"`;
      for (const [k, v] of Object.entries(runtimeEnv)) {
        const safe = v.replace(/"/g, '\\"');
        runCmd += ` -e "${k}=${safe}"`;
      }
      // Ensure PORT env var matches what the container actually listens on
      runCmd += ` -e "PORT=${finalContainerPort}"`;
      runCmd += ` --name ${containerName} ${imageTag}`;

      let containerId;
      let runSuccess = false;
      let runError = null;

      try {
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const { stdout } = await execAsync(runCmd);
            containerId = stdout.trim();
            runSuccess = true;
            break;
          } catch (err) {
            runError = err;
            if (attempt === 1 && (
              err.message.includes('name') || 
              err.message.includes('already in use') || 
              err.message.includes('Conflict') ||
              err.message.includes('port') ||
              err.message.includes('allocated') ||
              err.message.includes('address already')
            )) {
              await log(`   ⏳ Container name or port bind conflict detected. Retrying force cleanup and delay release...`);
              try { await execAsync(`docker rm -f ${containerName}`); } catch {}
              await new Promise(r => setTimeout(r, 1500)); // wait 1.5s for Docker port/name release
              continue;
            }
            break;
          }
        }

        if (!runSuccess) {
          if (runError.message.includes('health check failed') || runError.message.includes('exited')) throw runError;
          await log(`   ❌ docker run failed: ${runError.message}`);
          throw new Error('Runtime execution failure');
        }

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
          const crashLogs = safeExec(`docker logs --tail 150 ${containerId} 2>&1`) || '';
          const logText = crashLogs.toString();

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

      const DOMAIN = (process.env.CLOUDFLARE_DOMAIN || 'launchlive.in').toLowerCase();
      const isNipIo = DOMAIN.includes('nip.io');

      if (!project.dnsRecordId && !isNipIo) {
        const dnsRecordId = await createSubdomain(project.subdomain);
        if (dnsRecordId) {
          await Project.findByIdAndUpdate(projectId, { dnsRecordId });
          await log('   ✅ DNS records propagated to Edge Network.');
        }

        setTimeout(async () => {
          const ok = await provisionSSL(project.subdomain, project.customDomain);
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
      await log('⚠️ DEVELOPMENT MODE: Running local build on Windows host…');
      try {
        const isFullstack = ['fullstack-split', 'mern'].includes(stack);
        const feDir = fs.existsSync(path.join(repoDir, 'client')) ? 'client' : (fs.existsSync(path.join(repoDir, 'frontend')) ? 'frontend' : '.');
        const beDir = fs.existsSync(path.join(repoDir, 'server')) ? 'server' : (fs.existsSync(path.join(repoDir, 'backend')) ? 'backend' : '.');

        if (isFullstack) {
          const { detectPackageManager } = require('../services/stackDetector.service');
          
          // 1. Install & Build Frontend
          const fePath = path.join(repoDir, feDir);
          if (fs.existsSync(path.join(fePath, 'package.json'))) {
            const fePm = detectPackageManager(fePath);
            await log(`📦 [Frontend] Running dependency installation: ${fePm.install}...`);
            execSync(fePm.install, { cwd: fePath, stdio: 'pipe' });
            await log('   ✅ [Frontend] Dependencies installed successfully.');

            await log(`🔨 [Frontend] Building project: ${fePm.run} build...`);
            try {
              execSync(`${fePm.run} build`, { cwd: fePath, stdio: 'pipe' });
            } catch (err) {
              await log(`   ⚠️ Standard build failed, trying vite build fallback...`);
              execSync('npx --yes vite build', { cwd: fePath, stdio: 'pipe' });
            }
            await log('   ✅ [Frontend] Built successfully.');
          }

          // 2. Install Backend
          const bePath = path.join(repoDir, beDir);
          if (fs.existsSync(path.join(bePath, 'package.json')) && beDir !== feDir) {
            const bePm = detectPackageManager(bePath);
            await log(`📦 [Backend] Running dependency installation: ${bePm.install}...`);
            execSync(bePm.install, { cwd: bePath, stdio: 'pipe' });
            await log('   ✅ [Backend] Dependencies installed successfully.');
          }
        } else {
          // Standard single-folder app installation & build
          if (fs.existsSync(path.join(repoDir, 'package.json'))) {
            const { detectPackageManager } = require('../services/stackDetector.service');
            const pm = detectPackageManager(repoDir);
            await log(`📦 Running dependency installation: ${pm.install}...`);
            execSync(pm.install, { cwd: repoDir, stdio: 'pipe' });
            await log('   ✅ Dependencies installed successfully.');

            const buildNeeded = ['react', 'vue', 'svelte', 'astro', 'angular', 'next', 'nuxt'].includes(stack);
            if (buildNeeded) {
              await log(`🔨 Building project: ${pm.run} build...`);
              execSync(`${pm.run} build`, { cwd: repoDir, stdio: 'pipe' });
              await log('   ✅ Project built successfully.');
            }
          } else {
            await log('ℹ️ No package.json found. Skipping dependency installation & build.');
          }
        }

        // 3. Start local server or set static port
        const isService = ['node', 'next', 'nuxt', 'mern', 'fullstack-split', 'express', 'fastify'].includes(stack);
        let hostPort = 0;
        let containerId = 'local-static';

        if (isService) {
          const { getNextFreePort } = require('../services/portAllocator.service');
          const { getStartCommand, detectPackageManager } = require('../services/stackDetector.service');
          
          const runCwd = isFullstack ? path.join(repoDir, beDir) : repoDir;
          const pm = detectPackageManager(runCwd);
          const start = getStartCommand(runCwd, pm.name);
          
          hostPort = project.port || await getNextFreePort();
          await log(`🚀 Launching local service process on port ${hostPort}...`);
          
          // Stop any process on the port
          if (project.port) {
            try {
              execSync(`cmd.exe /c "npx --yes kill-port ${project.port}"`, { stdio: 'ignore' });
            } catch (e) {}
          }
          
          const localEnv = {
            ...process.env,
            ...runtimeEnv,
            PORT: String(hostPort),
          };

          const runCmd = start.isScript ? (pm.name === 'npm' ? 'npm.cmd' : pm.name) : start.cmd;
          const runArgs = start.isScript ? start.args : start.args;

          const { spawn } = require('child_process');
          const logStream = fs.createWriteStream(path.join(runCwd, 'local-server.log'), { flags: 'a' });
          
          const child = spawn(runCmd, runArgs, {
            cwd: runCwd,
            env: localEnv,
            shell: true,
            detached: true,
            stdio: ['ignore', logStream, logStream]
          });
          child.unref();
          containerId = String(child.pid);
          
          await log(`   ✅ Process spawned (PID: ${containerId}). Performing local health check...`);

          // HTTP Probe check
          let appHealthy = false;
          for (let attempt = 1; attempt <= 10; attempt++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
              const axios = require('axios');
              const res = await axios.get(`http://127.0.0.1:${hostPort}/`, { timeout: 1000 });
              if (res.status >= 200 && res.status < 500) {
                appHealthy = true;
                break;
              }
            } catch (e) {
              // try again
            }
          }
          
          if (!appHealthy) {
            await log(`   ⚠️ Local health check did not receive a successful response yet, but process is running.`);
          } else {
            await log(`   ✅ Local health check passed.`);
          }
        }

        await Project.findByIdAndUpdate(projectId, {
          port: hostPort,
          containerId,
          status: 'live'
        });

      } catch (localBuildErr) {
        await log(`❌ Local build/run failed: ${localBuildErr.message}`);
        throw localBuildErr;
      }
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

    if (deployment.isAutoHeal) {
      try {
        await log(`🤖 LaunchPad AI Auto-Healing is executing Git updates (${project.autoHealStrategy || 'push-on-success'})...`);
        await pushAuditStep(deployment.parentDeployment, 'Verifying Build', 'success', 'Health check passed. Container is online and healthy!');
        await pushAuditStep(deployment._id, 'Verifying Build', 'success', 'Health check passed. Container is online and healthy!');

        const { commitAndPushFix } = require('../services/autoHeal.service');
        const gitMessage = await commitAndPushFix(project, repoDir, project.autoHealStrategy || 'push-on-success', deployment.parentDeployment);
        await log(`🤖 Git Action: ${gitMessage}`);

        await pushAuditStep(deployment.parentDeployment, 'Git Push', 'success', gitMessage);
        await pushAuditStep(deployment._id, 'Git Push', 'success', gitMessage);

        try {
          await execAsync(`git -C "${repoDir}" tag -d launchpad-checkpoint-${deployment.parentDeployment}`);
        } catch {}
      } catch (gitErr) {
        await log(`⚠️ Git push failed: ${gitErr.message}`);
        await pushAuditStep(deployment.parentDeployment, 'Git Push', 'failure', gitErr.message);
        await pushAuditStep(deployment._id, 'Git Push', 'failure', gitErr.message);
      }
    }

    if (project.owner?.email) {
      sendDeployNotification(project.owner.email, {
        projectName: project.name, status: 'success',
        url: liveUrl, commitMsg: deployment.commitMessage,
      }).catch(() => {});
    }

  } catch (err) {
    await log(`\n🛑 DEPLOYMENT ABORTED: ${err.message}`);

    let logsText = '';
    try {
      const fresh   = await Deployment.findById(deploymentId);
      logsText = fresh.logs.join('\n');
      let diagnosis;
      try {
        diagnosis = await analyzeError(logsText, project.stack);
      } catch (aiErr) {
        console.warn('[Build Worker] AI analysis failed, falling back to local diagnosis:', aiErr.message);
      }

      const isUnavailable = !diagnosis || !diagnosis.summary || /unavailable|Could not reach/i.test(diagnosis.summary);
      const finalDiagnosis = isUnavailable ? localDiagnoseError(logsText, project.stack) : diagnosis;

      const formattedSummary = `${finalDiagnosis.summary || finalDiagnosis.cause || 'Deployment failed.'}\n\n🔍 Root Cause: ${finalDiagnosis.cause || 'Unknown.'}\n\n🛠️ Quick Fix: ${finalDiagnosis.fix || 'Check logs for details.'}${finalDiagnosis.commands?.length ? '\n\n💻 Suggested commands:\n' + finalDiagnosis.commands.map(c => '  $ ' + c).join('\n') : ''}`;

      await Deployment.findByIdAndUpdate(deploymentId, { aiErrorSummary: formattedSummary });
      await log(`🤖 Diagnosis:\n${formattedSummary}`);
    } catch (diagErr) {
      console.error('[Build Worker] Failed to run build error diagnosis:', diagErr.message);
    }

    // AI Auto-Healing Section
    if (project.autoHeal && !deployment.isAutoHeal) {
      try {
        await log(`\n🤖 LaunchPad AI Auto-Healing is analyzing repository for a fix...`);
        await pushAuditStep(deploymentId, 'Analyzing logs', 'info', 'Parsing error logs to identify relevant files...');

        const { generateFixPatch, applyPatchLocally } = require('../services/autoHeal.service');
        const fixPatch = await generateFixPatch(repoDir, logsText, project.stack);
        
        if (fixPatch && fixPatch.patches && fixPatch.patches.length > 0) {
          await log(`🤖 Auto-Healing patch generated: ${fixPatch.description}`);
          await pushAuditStep(deploymentId, 'Generating Code Fix', 'success', `DevOps AI generated code fix: ${fixPatch.description}`);

          const checkpointTag = `launchpad-checkpoint-${deploymentId}`;
          try {
            await execAsync(`git -C "${repoDir}" tag -f "${checkpointTag}"`);
            await pushAuditStep(deploymentId, 'Applying Patch', 'info', `Created git checkpoint: ${checkpointTag}`);
          } catch (gitTagErr) {
            console.error('[Auto-Heal] Git tag checkpoint creation failed:', gitTagErr.message);
          }

          const { applied, diffOutput } = applyPatchLocally(repoDir, fixPatch.patches);
          
          if (applied.length > 0 && applied.length === fixPatch.patches.length) {
            await log(`🤖 Applied all fixes to files: ${applied.join(', ')}`);
            await pushAuditStep(deploymentId, 'Applying Patch', 'success', `Patched files: ${applied.join(', ')}`);
            
            // Queue follow-up auto-heal deployment
            const autoHealDep = await Deployment.create({
              project:       project._id,
              triggeredBy:   deployment.triggeredBy || project.owner?._id,
              commitSha:     deployment.commitSha,
              commitMessage: `🤖 Auto-healed: ${fixPatch.description}`,
              branch:        project.branch,
              status:        'queued',
              isAutoHeal:    true,
              parentDeployment: deployment._id,
              autoHealFixDescription: fixPatch.description,
              autoHealDiff: diffOutput,
              autoHealAuditTrail: [
                { step: 'Analyzing logs', status: 'success', details: 'Parsed build logs to identify files', timestamp: new Date() },
                { step: 'Generating Code Fix', status: 'success', details: `DevOps AI generated code fix: ${fixPatch.description}`, timestamp: new Date() },
                { step: 'Applying Patch', status: 'success', details: `Patched files: ${applied.join(', ')}`, timestamp: new Date() }
              ]
            });

            await buildQueue.add(
              { deploymentId: autoHealDep._id.toString(), projectId: project._id.toString() },
              {
                attempts: 2,
                backoff: { type: 'exponential', delay: 5000 },
                removeOnComplete: 50,
                removeOnFail: 50
              }
            );

            await log(`🤖 Successfully queued auto-healed deployment: ${autoHealDep._id}`);
            await pushAuditStep(deploymentId, 'Queueing Rebuild', 'success', `Queued auto-heal deployment: ${autoHealDep._id}`);

            // Mark current deployment as failed
            await Deployment.findByIdAndUpdate(deploymentId, {
              status: 'failed', finishedAt: new Date(),
            });
            // Update project status to building
            await Project.findByIdAndUpdate(projectId, { status: 'building' });
            return; // Exit early: follow-up auto-heal job will handle live/failed state
          } else {
            // Revert any partially applied files and untracked files
            try {
              await execAsync(`git -C "${repoDir}" reset --hard "${checkpointTag}"`);
              await execAsync(`git -C "${repoDir}" clean -fd`);
              await execAsync(`git -C "${repoDir}" tag -d "${checkpointTag}"`);
            } catch (revertErr) {
              await execAsync(`git -C "${repoDir}" reset --hard HEAD`);
              await execAsync(`git -C "${repoDir}" clean -fd`);
            }
            const details = applied.length > 0 
              ? `Applied only ${applied.length} of ${fixPatch.patches.length} patches. Rollback completed.` 
              : 'Could not apply any generated AI patches to files.';
            await log(`⚠️ Auto-Healing aborted: ${details}`);
            await pushAuditStep(deploymentId, 'Applying Patch', 'failure', details);
          }
        } else {
          await log(`⚠️ Auto-Healing did not find a reliable code patch for this error.`);
          await pushAuditStep(deploymentId, 'Generating Code Fix', 'failure', 'DevOps AI could not generate a reliable code patch');
        }
      } catch (autoHealErr) {
        await log(`⚠️ Auto-Healing encountered an error: ${autoHealErr.message}`);
        await pushAuditStep(deploymentId, 'Analyzing logs', 'failure', `Error: ${autoHealErr.message}`);
      }
    }

    if (deployment.isAutoHeal) {
      try {
        await pushAuditStep(deployment.parentDeployment, 'Verifying Build', 'failure', 'Container health check failed. Reverting changes.');
        await pushAuditStep(deployment._id, 'Verifying Build', 'failure', 'Container health check failed. Reverting changes.');

        try {
          await execAsync(`git -C "${repoDir}" reset --hard launchpad-checkpoint-${deployment.parentDeployment}`);
          await execAsync(`git -C "${repoDir}" clean -fd`);
          await execAsync(`git -C "${repoDir}" tag -d launchpad-checkpoint-${deployment.parentDeployment}`);
          await log(`❌ Auto-healing attempt failed. Reverted local file changes using git checkpoint tag.`);
        } catch {
          await execAsync(`git -C "${repoDir}" reset --hard HEAD`);
          await execAsync(`git -C "${repoDir}" clean -fd`);
          await log(`❌ Auto-healing attempt failed. Reverted local file changes using fallback git reset.`);
        }
      } catch (revertErr) {
        console.error('[Auto-Heal] Failed to revert repository:', revertErr.message);
      }
    }

    await Deployment.findByIdAndUpdate(deploymentId, {
      status: 'failed', finishedAt: new Date(),
    });

    // ── Guard: only mark project as 'failed' if there is no newer successful deployment ──
    // This prevents a retried old job from overwriting a newer successful live deployment.
    const latestSuccessfulDeploy = await Deployment.findOne({
      project: projectId,
      status: 'success',
    }).sort({ finishedAt: -1 }).select('finishedAt');

    const thisDeploymentRecord = await Deployment.findById(deploymentId).select('finishedAt createdAt');
    const thisTimestamp = thisDeploymentRecord?.finishedAt || thisDeploymentRecord?.createdAt || new Date(0);

    if (!latestSuccessfulDeploy || new Date(latestSuccessfulDeploy.finishedAt) < new Date(thisTimestamp)) {
      // No newer success exists — safe to mark as failed
      await Project.findByIdAndUpdate(projectId, { status: 'failed' });
    } else {
      // A newer successful deployment already exists — keep the project as 'live'
      await log(`ℹ️ A newer successful deployment exists. Keeping project status as 'live'.`);
    }

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