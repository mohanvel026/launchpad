const fs         = require('fs');
const path       = require('path');
const Project    = require('../models/Project.model');
const Deployment = require('../models/Deployment.model');
const { callAI, generateOptimizationAdvice, getGeminiKeyPool, getGroqKeyPool, compressLogs } = require('../services/ai.service');

/**
 * Standard API error responder if keys are missing
 */
const checkApiKeys = () => {
  const hasGemini = getGeminiKeyPool().length > 0;
  const hasGroq   = getGroqKeyPool().length > 0;
  if (!hasGemini && !hasGroq) {
    throw new Error('No valid API keys found. Please add GEMINI_API_KEY or GROQ_API_KEY to your .env');
  }
};

// ─── Lightweight Repository Tree Helper ───────────────────────────────────────
const getLightweightRepoTree = (dir, depth = 0, maxDepth = 2) => {
  if (depth > maxDepth) return '';
  let result = '';
  try {
    const files = fs.readdirSync(dir);
    // Sort directories first, files second
    const stats = files.map(file => {
      const fullPath = path.join(dir, file);
      try {
        return { file, isDir: fs.statSync(fullPath).isDirectory() };
      } catch {
        return { file, isDir: false };
      }
    });
    
    stats.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.file.localeCompare(b.file);
    });

    stats.forEach(({ file, isDir }) => {
      if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage', '.cache', 'tmp'].includes(file)) return;
      const prefix = '  '.repeat(depth) + (isDir ? '📁 ' : '📄 ');
      result += `${prefix}${file}\n`;
      if (isDir) {
        result += getLightweightRepoTree(path.join(dir, file), depth + 1, maxDepth);
      }
    });
  } catch (err) {
    // Ignore error
  }
  return result;
};

// ─── POST /api/ai/:projectId/chat ─────────────────────────────────────────────
const chatWithAI = async (req, res) => {
  const { message, history = [], context } = req.body;
  if (!message) return res.status(400).json({ message: 'message is required' });

  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const latestDeploy = await Deployment.findOne({ project: project._id })
      .sort({ createdAt: -1 })
      .select('status commitMessage aiErrorSummary logs stack');

    // Compress build failure logs if present to optimize token constraints
    let compressedFailureLogs = '';
    if (latestDeploy && latestDeploy.status === 'failed' && latestDeploy.logs) {
      const rawLogs = Array.isArray(latestDeploy.logs) ? latestDeploy.logs.join('\n') : String(latestDeploy.logs);
      compressedFailureLogs = compressLogs(rawLogs, 3000);
    }

    // Build rich, live contextual repository details to empower custom SRE questions
    let repoContext = '';
    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    if (fs.existsSync(repoPath)) {
      try {
        const rootFiles = fs.readdirSync(repoPath);
        repoContext += `- Root files in workspace: ${rootFiles.slice(0, 30).join(', ')}\n`;

        const tree = getLightweightRepoTree(repoPath, 0, 2);
        if (tree) {
          repoContext += `- Repository Directory Structure (up to depth 2):\n${tree.slice(0, 1500)}\n`;
        }

        const dockerfilePath = path.join(repoPath, 'Dockerfile');
        if (fs.existsSync(dockerfilePath)) {
          repoContext += `- Dockerfile Content:\n\`\`\`dockerfile\n${fs.readFileSync(dockerfilePath, 'utf8').slice(0, 800)}\n\`\`\`\n`;
        }

        const pkgPath = path.join(repoPath, 'package.json');
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
          const scripts = pkg.scripts || {};
          repoContext += `- package.json Scripts: ${JSON.stringify(scripts)}\n`;
          const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          repoContext += `- Dependencies installed: ${Object.keys(deps).slice(0, 40).join(', ')}\n`;
        }
      } catch (repoErr) {
        console.warn('[AI Chat Context] Failed to scan workspace root:', repoErr.message);
      }
    }

    let richContextPrompt = '';
    if (context) {
      const { activeTab, recentDeploys, metrics } = context;
      richContextPrompt += '\nActive User Interface Context:\n';
      if (activeTab) {
        richContextPrompt += `- Developer is currently looking at tab: "${activeTab}"\n`;
      }
      if (recentDeploys && Array.isArray(recentDeploys) && recentDeploys.length > 0) {
        richContextPrompt += `- Recent deployment history:\n`;
        recentDeploys.forEach((dep, idx) => {
          const statusStr = dep.status || 'unknown';
          const msgStr = dep.message ? ` - ${dep.message}` : '';
          const durStr = dep.duration ? ` (duration: ${(dep.duration / 1000).toFixed(1)}s)` : '';
          const errStr = dep.error ? ` (AI Diagnosis: ${dep.error})` : '';
          richContextPrompt += `  * Run ${idx + 1}: ${statusStr}${msgStr}${durStr}${errStr}\n`;
        });
      }
      if (metrics) {
        const cpuStr = (metrics.cpu !== undefined && metrics.cpu !== null) ? `${metrics.cpu}%` : 'unknown';
        const ramStr = (metrics.ram !== undefined && metrics.ram !== null) ? `${metrics.ram}MB` : 'unknown';
        richContextPrompt += `- Active Container Metrics: CPU: ${cpuStr}, RAM: ${ramStr}\n`;
      }
    }

    // Build rich contextual DevOps System Prompt
    const systemPrompt = `You are LaunchLive DevOps AI, an elite cloud systems SRE expert.
Context:
- Project Name: ${project.name}
- Current Framework/Stack: ${project.stack}
- Project Active Status: ${project.status}
- Latest Deployment: ${latestDeploy ? `${latestDeploy.status} (${latestDeploy.commitMessage || 'No msg'})` : 'None'}
${richContextPrompt}
${repoContext ? `- Live Repository Scan Details:\n${repoContext}` : ''}
${compressedFailureLogs ? `- Recent Failure Logs (Cleaned & Compressed): \n${compressedFailureLogs}` : ''}

Your tone should be highly professional, technical, direct, and helpful. Always provide actionable tips, commands, or config templates when asked.

CRITICAL FORMATTING INSTRUCTIONS:
1. Do NOT output a single continuous wall of text.
2. ALWAYS divide your message into clear, distinct sections using bold headers (e.g. **🔍 Root Cause**, **🛠️ Remediation Steps**).
3. Use separate lines and bullet lists (e.g. - or numbered lists) instead of wrapping text.
4. Encapsulate all command-line fixes or file modifications inside code blocks (e.g. \`\`\`bash ... \`\`\` or \`\`\`json ... \`\`\`).
5. Highlight files or keywords using inline code (e.g. \`package.json\`).`;

    const chatHistory = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
    const userPromptWithHistory = `${chatHistory}\nUser: ${message}`;

    const reply = await callAI(systemPrompt, userPromptWithHistory, 800, false);

    // Return a friendly in-chat message instead of a 500 when AI is temporarily unavailable
    if (!reply) {
      return res.json({
        reply: '⚠️ **AI temporarily rate-limited.** Both Gemini and Groq are cooling down.\n\nPlease wait **20–30 seconds** and try again. This happens when many AI scans run in quick succession. The service will recover automatically.'
      });
    }

    res.json({ reply });
  } catch (err) {
    const errMsg = err?.message || 'Unknown server error';
    console.error('[AI Chat Error]:', errMsg);
    if (errMsg.includes('No valid API keys')) {
      return res.json({
        reply: "Sorry, I can't chat right now! 🤖\n\nTo activate me, please add a `GEMINI_API_KEY` or `GROQ_API_KEY` to your `server/.env` file and restart the server.\n\n*(Tip: Both are completely FREE to get!)*"
      });
    }
    // Return graceful in-chat error instead of 500
    return res.json({ reply: `❌ **System error:** ${errMsg}\n\nPlease try again in a moment.` });
  }
};

// ─── POST /api/ai/:projectId/suggest-fix ─────────────────────────────────────
const suggestFix = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const latestDeploy = await Deployment.findOne({ project: project._id }).sort({ createdAt: -1 });
    if (!latestDeploy) return res.json({ suggestion: 'No deployments found to analyze.' });

    // If we already saved an AI summary on failure, return it immediately to save tokens
    if (latestDeploy.status === 'failed' && latestDeploy.aiErrorSummary) {
      return res.json({ suggestion: latestDeploy.aiErrorSummary });
    }

    // Read project files structure to pass to AI for architectural context
    let filesList = [];
    try {
      const repoPath = path.join(process.env.REPOS_DIR || '/var/launchpad/repos', project._id.toString());
      if (fs.existsSync(repoPath)) {
        filesList = fs.readdirSync(repoPath);
      }
    } catch (e) {
      console.warn('Failed to read repo directory structure:', e.message);
    }

    const fileStructure = filesList.length ? filesList.join(', ') : 'No files found or unable to access repository';
    const rawLogs = latestDeploy.logs ? (Array.isArray(latestDeploy.logs) ? latestDeploy.logs.join('\n') : String(latestDeploy.logs)) : '';
    const logs = compressLogs(rawLogs, 3000) || 'No logs available';

    const systemPrompt = `You are LaunchLive DevOps AI. Analyze the build failure and write a 2-3 sentence technical diagnosis.
Be precise. State the exact file, parameter, or command that failed, and tell the developer the exact fix.`;

    const userPrompt = `Project Stack: ${project.stack}
Build Status: ${latestDeploy.status}
Files present: ${fileStructure}

Recent Build/Runtime Logs (Cleaned & Compressed):
${logs}`;

    const suggestion = await callAI(systemPrompt, userPrompt, 400, false);
    if (suggestion) {
      await Deployment.findByIdAndUpdate(latestDeploy._id, { aiErrorSummary: suggestion });
    }

    res.json({ suggestion: suggestion || 'Could not analyze build logs at this time.' });
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({
        suggestion: "To use the AI Diagnostic tool, add a free `GEMINI_API_KEY` or `GROQ_API_KEY` to your `.env` file!"
      });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/optimize-config ───────────────────────────────
const optimizeConfig = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(process.env.REPOS_DIR || '/var/launchpad/repos', project._id.toString());
    let filesList = [];
    let packageJson = '';
    let dockerfile = '';

    if (fs.existsSync(repoPath)) {
      filesList = fs.readdirSync(repoPath);
      
      const pkgPath = path.join(repoPath, 'package.json');
      if (fs.existsSync(pkgPath)) packageJson = fs.readFileSync(pkgPath, 'utf8');

      const dockerfilePath = path.join(repoPath, 'Dockerfile');
      if (fs.existsSync(dockerfilePath)) dockerfile = fs.readFileSync(dockerfilePath, 'utf8');
    }

    const advice = await generateOptimizationAdvice(filesList, packageJson, dockerfile, project.stack);
    res.json(advice);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({
        score: 100,
        recommendations: [{ type: "Security", issue: "AI keys missing", fix: "Add a free GEMINI_API_KEY to activate optimizations!" }],
        optimizedDockerfile: ""
      });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/discover-env ──────────────────────────────────
const discoverEnv = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    const { scanRepository, generateSuggestedValue } = require('../services/envScanner.service');

    const { candidateKeys, dependenciesList, securityWarnings, collisions } = scanRepository(repoPath, project.stack);

    const aggregatedCode = candidateKeys.map(k => `process.env.${k}`).join('\n');

    const { discoverRequiredEnvVars } = require('../services/ai.service');
    const result = await discoverRequiredEnvVars(aggregatedCode, project.stack, dependenciesList, securityWarnings, collisions);

    // Guaranteed static injection fallback: Merge statically-scanned keys directly into result.detectedVars
    const resultKeys = new Set((result.detectedVars || []).map(v => v.key.toUpperCase()));
    result.detectedVars = result.detectedVars || [];
    
    candidateKeys.forEach(k => {
      if (k && !resultKeys.has(k.toUpperCase())) {
        const suggestedValue = generateSuggestedValue(k);
        let validationPattern = '';
        let validationErrorMessage = '';

        if (k.toUpperCase().includes('MONGO')) {
          validationPattern = '^(mongodb(?:\\+srv)?):\\/\\/.+$';
          validationErrorMessage = 'Must be a valid MongoDB connection string starting with mongodb:// or mongodb+srv://';
        } else if (k.toUpperCase().includes('PORT')) {
          validationPattern = '^\\d{2,5}$';
          validationErrorMessage = 'Must be a valid port number (e.g. 3000 to 65535)';
        } else if (k.toUpperCase().includes('URL') || k.toUpperCase().includes('URI')) {
          validationPattern = '^https?:\\/\\/.+$';
          validationErrorMessage = 'Must be a valid URL starting with http:// or https://';
        }

        result.detectedVars.push({
          key: k,
          required: true,
          description: 'Auto-detected via static codebase scan.',
          placeholder: `your_${k.toLowerCase()}_here`,
          suggestedValue,
          validationPattern,
          validationErrorMessage
        });
        resultKeys.add(k.toUpperCase());
      }
    });

    // Auto-generate and write a highly professional .env.example file to their cloned workspace
    if (result.detectedVars && result.detectedVars.length > 0) {
      if (fs.existsSync(repoPath)) {
        try {
          let envExampleContent = `# ─── GENERATED BY LAUNCHLIVE AI ──────────────────────────────────\n`;
          envExampleContent += `# This file documents all environment variables expected by this application.\n`;
          envExampleContent += `# Copy this file to '.env' and fill in your actual private secrets for local development.\n\n`;

          result.detectedVars.forEach(v => {
            envExampleContent += `# Description: ${v.description}\n`;
            if (v.validationErrorMessage) {
              envExampleContent += `# Validation: ${v.validationErrorMessage}\n`;
            }
            envExampleContent += `${v.key}=${v.placeholder || 'your_' + v.key.toLowerCase() + '_here'}\n\n`;
          });

          fs.writeFileSync(path.join(repoPath, '.env.example'), envExampleContent, 'utf8');
          console.log(`[AI Env Discovery] Wrote .env.example to ${project.name} repo successfully.`);
        } catch (writeErr) {
          console.warn('[AI Env Discovery] Failed to write .env.example:', writeErr.message);
        }
      }

      // Elite Automation: Automagically write discovered env vars directly to LaunchLive database
      const EnvVar = require('../models/EnvVar.model');
      const CryptoJS = require('crypto-js');

      for (const v of result.detectedVars) {
        try {
          // Check if it already exists to avoid overwriting user's active variables
          const existing = await EnvVar.findOne({ project: project._id, key: v.key });
          if (!existing) {
            // Securely encrypt the suggested high-entropy key or default placeholder value
            const defaultValue = v.suggestedValue || v.placeholder || `your_${v.key.toLowerCase()}_placeholder`;
            const encryptedValue = CryptoJS.AES.encrypt(defaultValue, process.env.ENCRYPTION_KEY).toString();

            await EnvVar.create({
              project: project._id,
              key: v.key,
              value: encryptedValue,
              isSecret: true
            });
            console.log(`[AI Env Discovery] Automagically saved missing variable ${v.key} to database for project ${project.name}`);
          }
        } catch (dbErr) {
          console.warn(`[AI Env Discovery] Failed to auto-save env var ${v.key}:`, dbErr.message);
        }
      }
    }

    res.json(result);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({ detectedVars: [] });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/inspect-logs ──────────────────────────────────
const inspectLogs = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const containerName = `lp-${project._id.toString().slice(-8)}`;
    const { execSync } = require('child_process');
    let runtimeLogs = '';
    try {
      const target = project.containerId || containerName;
      runtimeLogs = execSync(`docker logs --tail 100 ${target} 2>&1`, { timeout: 15000 }).toString();
    } catch (e) {
      try {
        // Fallback: try finding container by wildcard name if containerId was missing/stale
        const containerIdFromDocker = execSync(`docker ps -a --filter "name=${containerName}" --format "{{.ID}}" | head -n 1`, { timeout: 5000 }).toString().trim();
        if (containerIdFromDocker) {
          runtimeLogs = execSync(`docker logs --tail 100 ${containerIdFromDocker} 2>&1`, { timeout: 15000 }).toString();
        } else {
          throw e;
        }
      } catch (e2) {
        runtimeLogs = 'No active container is running or logs are unavailable.';
      }
    }

    const { inspectRuntimeLogs } = require('../services/ai.service');
    const health = await inspectRuntimeLogs(runtimeLogs, project.stack);
    res.json(health);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({ isHealthy: true, anomalies: [] });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/optimize-queries ──────────────────────────────
const optimizeDbQueries = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    let dbCode = '';

    if (fs.existsSync(repoPath)) {
      const scanForDbOps = (dir, depth = 0) => {
        if (depth > 6) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage', 'public'].includes(file)) {
              scanForDbOps(fullPath, depth + 1);
            }
          } else if (/\.(js|ts|py|prisma|sql)$/i.test(file)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Look for database keywords: Schema, find, findOne, select, insert, Prisma
            if (/mongoose|prisma|find|select|insert|update|delete|schema/i.test(content) || file.endsWith('.prisma') || file.endsWith('.sql')) {
              if (dbCode.length < 18000) {
                dbCode += `\n// File: ${file}\n` + content.slice(0, 2000);
              }
            }
          }
        }
      };
      scanForDbOps(repoPath);
    }

    const { optimizeQueries } = require('../services/ai.service');
    const optimization = await optimizeQueries(dbCode, project.stack);
    res.json(optimization);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({ recommendations: [] });
    }
    res.status(500).json({ message: err.message });
  }
};


// ─── POST /api/ai/:projectId/generate-docs ────────────────────────────────
const generateDocs = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    let docCode = '';
    let folderTree = '';

    const getFolderTree = (dir, depth = 0, maxDepth = 3) => {
      if (depth > maxDepth) return '';
      let result = '';
      let files;
      try {
        files = fs.readdirSync(dir);
      } catch {
        return '';
      }
      files.forEach((file, idx) => {
        if (['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage', 'public', '.cache'].includes(file)) return;
        const fullPath = path.join(dir, file);
        let stat;
        try { stat = fs.statSync(fullPath); } catch { return; }
        const prefix = '  '.repeat(depth) + (idx === files.length - 1 ? '└── ' : '├── ');
        if (stat.isDirectory()) {
          result += `${prefix}${file}/\n` + getFolderTree(fullPath, depth + 1, maxDepth);
        } else {
          result += `${prefix}${file}\n`;
        }
      });
      return result;
    };

    if (fs.existsSync(repoPath)) {
      folderTree = getFolderTree(repoPath);
      const scanForCode = (dir, depth = 0) => {
        if (depth > 6 || docCode.length > 14000) return;
        let files;
        try { files = fs.readdirSync(dir); } catch { return; }
        for (const file of files) {
          const fullPath = path.join(dir, file);
          let stat;
          try { stat = fs.statSync(fullPath); } catch { continue; }
          if (stat.isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage', 'public', '.cache'].includes(file)) {
              scanForCode(fullPath, depth + 1);
            }
          } else if (/\.(js|ts|jsx|tsx|py|prisma|sql|json)$/i.test(file) && !file.includes('.min.')) {
            try {
              const content = fs.readFileSync(fullPath, 'utf8');
              if (docCode.length < 14000) {
                docCode += `\n// === File: ${file} ===\n` + content.slice(0, 1500);
              }
            } catch { /* skip unreadable files */ }
          }
        }
      };
      scanForCode(repoPath);
    }

    // Always provide rich project metadata — works even when repo is not yet cloned
    const projectContext = [
      `Project Name: ${project.name}`,
      `Repository: ${project.repoFullName}`,
      `Branch: ${project.branch || 'main'}`,
      `Stack: ${project.stack}`,
      `Status: ${project.status}`,
      folderTree ? `\nDirectory Layout Structure:\n${folderTree}` : '',
      docCode
        ? `\nSource Code Snippets:\n${docCode}`
        : '\n(Repository not yet cloned — generate docs based on project metadata and stack conventions only)'
    ].join('\n');

    const { generateDocsAndReadme } = require('../services/ai.service');
    const docs = await generateDocsAndReadme(projectContext, project.stack);

    // Auto-commit generated README.md file directly into cloned workspace root
    if (docs.readme && fs.existsSync(repoPath)) {
      try {
        fs.writeFileSync(path.join(repoPath, 'README.md'), docs.readme, 'utf8');
        console.log(`[AI Doc Gen] Saved README.md to ${project.name} repo successfully.`);
      } catch (writeErr) {
        console.warn('[AI Doc Gen] Failed to write README.md:', writeErr.message);
      }
    }

    res.json(docs);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({ readme: '# Offline', apiDocs: '# API Reference Offline', apiEndpoints: [] });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/audit-security ────────────────────────────────
const auditSecurity = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    let packageJson = '';
    let secCode = '';

    if (fs.existsSync(repoPath)) {
      const pkgPath = path.join(repoPath, 'package.json');
      if (fs.existsSync(pkgPath)) packageJson = fs.readFileSync(pkgPath, 'utf8');

      const scanForSecurityPatterns = (dir, depth = 0) => {
        if (depth > 6) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (!['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 'coverage', 'public'].includes(file)) {
              scanForSecurityPatterns(fullPath, depth + 1);
            }
          } else if (/\.(js|ts|py|json|prisma|sql)$/i.test(file)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Grab files dealing with server setups, auth, database, helmet, cors
            if (/helmet|cors|express-rate-limit|express-validator|bcrypt|jwt\.verify|passport|session/i.test(content) || file.endsWith('.prisma') || file.endsWith('.sql')) {
              if (secCode.length < 18000) {
                secCode += `\n// File: ${file}\n` + content.slice(0, 2000);
              }
            }
          }
        }
      };
      scanForSecurityPatterns(repoPath);
    }

    // High-speed MD5 Checksum Cache
    const crypto = require('crypto');
    const contentHash = crypto.createHash('md5').update(packageJson + secCode).digest('hex');
    
    // In-memory global security audit cache
    global.securityAuditCache = global.securityAuditCache || {};
    if (global.securityAuditCache[project._id] && global.securityAuditCache[project._id].hash === contentHash) {
      console.log(`[AI Security Auditor] Returning cached security audit for ${project.name} (Hit in 2ms)`);
      return res.json(global.securityAuditCache[project._id].data);
    }

    const { auditSecurityAndDependencies } = require('../services/ai.service');
    const auditReport = await auditSecurityAndDependencies(packageJson, secCode, project.stack);
    
    // Cache the result
    global.securityAuditCache[project._id] = { hash: contentHash, data: auditReport };
    
    res.json(auditReport);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({ securityScore: 100, issues: [] });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/predict-resources ──────────────────────────────
const predictResources = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Retrieve active container telemetry and metrics history
    const { getCachedStats, getMetricHistory } = require('../services/metrics.service');
    let liveStats = { cpu: 0, memMB: 0, status: 'stopped' };
    let history = [];

    if (project.containerId) {
      try {
        liveStats = await getCachedStats(project.containerId);
        history = await getMetricHistory(project._id.toString());
      } catch (metricsErr) {
        console.warn('[AI Capacity Planner] Failed to get live container metrics:', metricsErr.message);
      }
    }

    // Retrieve daily network traffic and latency analytics
    const { getAnalytics } = require('../services/analytics.service');
    let trafficAnalytics = { totalVisits: 0, totalErrors: 0, avgResponseTime: 0, uptime: '100%', days: [] };
    try {
      trafficAnalytics = await getAnalytics(project._id.toString());
    } catch (analyticsErr) {
      console.warn('[AI Capacity Planner] Failed to get project analytics:', analyticsErr.message);
    }

    const { analyzeTelemetryAndPredictScaling } = require('../services/ai.service');
    const prediction = await analyzeTelemetryAndPredictScaling(liveStats, history, trafficAnalytics, project.stack);
    res.json(prediction);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({
        cpuUsageAnalysis: 'AI keys offline.',
        ramUsageAnalysis: 'AI keys offline.',
        anomalyAlerts: [],
        predictedGrowth: 'Capacity planning requires active GEMINI_API_KEY credentials.',
        recommendedCpu: '0.5',
        recommendedRam: '256',
        scalingAdvice: []
      });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/devops-summary ──────────────────────────────────
const devopsSummary = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    let packageJson = '';
    let secCode = '';

    if (fs.existsSync(repoPath)) {
      const pkgPath = path.join(repoPath, 'package.json');
      if (fs.existsSync(pkgPath)) packageJson = fs.readFileSync(pkgPath, 'utf8');

      // Quick code scan for hashing
      const files = fs.readdirSync(repoPath);
      files.forEach(f => {
        const full = path.join(repoPath, f);
        if (fs.statSync(full).isFile() && /\.(js|json)$/.test(f)) {
          secCode += fs.readFileSync(full, 'utf8').slice(0, 1000);
        }
      });
    }

    const crypto = require('crypto');
    const summaryHash = crypto.createHash('md5').update(project.stack + packageJson + secCode).digest('hex');

    global.devopsSummaryCache = global.devopsSummaryCache || {};
    if (global.devopsSummaryCache[project._id] && global.devopsSummaryCache[project._id].hash === summaryHash) {
      console.log(`[AI DevOps Summary] Returning cached overview for ${project.name} (Hit in 1ms)`);
      return res.json(global.devopsSummaryCache[project._id].data);
    }

    // Call SRE and Capacity predictors concurrently (gracefully staggered by our rate limit queue)
    const { predictResourceRequirements, auditSecurityAndDependencies } = require('../services/ai.service');
    
    const [resources, security] = await Promise.all([
      predictResourceRequirements(packageJson, project.stack),
      auditSecurityAndDependencies(packageJson, secCode, project.stack)
    ]);

    const overview = {
      projectStack: project.stack || 'unknown',
      securityScore: security.securityScore || 100,
      securityGrade: security.securityGrade || 'A+',
      vulnerabilitiesCount: security.issues ? security.issues.length : 0,
      recommendedCpu: resources.cpuLimit || '0.5',
      recommendedRam: resources.ramLimitMB ? `${resources.ramLimitMB}MB` : '256MB',
      needsRedisCache: !!resources.needsRedis,
      healthStatus: 'Excellent',
    };

    // Cache the response
    global.devopsSummaryCache[project._id] = { hash: summaryHash, data: overview };

    res.json(overview);
  } catch (err) {
    if (err.message?.includes('No valid API keys')) {
      return res.json({
        projectStack: 'unknown',
        securityScore: 100,
        securityGrade: 'A+',
        vulnerabilitiesCount: 0,
        recommendedCpu: '0.5',
        recommendedRam: '256MB',
        needsRedisCache: false,
        healthStatus: 'AI Offline — Add GEMINI_API_KEY to activate DevOps insights.',
      });
    }
    res.status(500).json({ message: err.message });
  }
};

// ─── POST /api/ai/:projectId/traffic-insights ────────────────────────────────
const analyzeTrafficInsights = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Retrieve active edge proxy traffic metrics
    const { getAnalytics } = require('../services/analytics.service');
    let trafficAnalytics = { totalVisits: 0, totalErrors: 0, avgResponseTime: 0, uptime: '100%', days: [], logs: [], routes: [] };
    try {
      trafficAnalytics = await getAnalytics(project._id.toString());
    } catch (analyticsErr) {
      console.warn('[AI Traffic Insights] Failed to get project analytics:', analyticsErr.message);
    }

    const totalVisits = trafficAnalytics.totalVisits || 0;
    const avgResponseTime = trafficAnalytics.avgResponseTime || 0;
    const totalErrors = trafficAnalytics.totalErrors || 0;
    const errorRate = totalVisits > 0 ? ((totalErrors / totalVisits) * 100).toFixed(1) : '0.0';
    const domain = process.env.CLOUDFLARE_DOMAIN || 'launchlive.in';

    const systemPrompt = `You are LaunchLive SRE Traffic Auditor, an elite systems observability and ingress routing AI.
Your task is to analyze edge traffic request logs, latencies, error distributions, and routing trends for a deployed application.
Generate a comprehensive, action-backed SRE Traffic Insights report in clean GitHub Flavored Markdown.
Your tone should be highly professional, technical, direct, and authoritative.

### IMPORTANT RULE FOR ZERO TRAFFIC STATE:
If total traffic is 0 or empty, DO NOT just say "there is no traffic, we cannot audit". Instead, trigger our **Elite Ingress Diagnostic & Connectivity Protocol**:
1. **Explain exactly why traffic shows 0** (e.g. DNS not propagated, client didn't visit subdomain URL yet, or Nginx edge configuration mismatch).
2. **Provide concrete test commands** using \`curl\` to test connection (e.g. \`curl -I https://${project.subdomain}.${domain}\`).
3. **Draft a pre-emptive SRE protection policy** (rate limiting, Nginx caching, connection bounds) that they can apply *before* the traffic hits.

Structure your markdown report exactly with the following sections (use bold titles and styled metrics):
1. **📊 Executive Traffic Summary**: Highlight active request volume, average latency, and health error ratios.
2. **⚡ Edge Connectivity & Diagnostics**: If 0 requests, detail step-by-step diagnostic actions (e.g., DNS verification, docker container health scans). If traffic exists, analyze latency bottlenecks.
3. **🛡️ Security & Anomaly Scan**: Scans recent log IPs and endpoints for malicious or abnormal behavior (e.g., DDOS spikes, brute-forcing). If 0 logs, specify pre-emptive security hardeners (like HTTP rate-limiting zone config).
4. **🛠️ Actionable SRE Tuning Plan**: Outline concrete optimization steps (e.g., static path caching, gzip compression, microservice limits). Provide exact, production-ready Nginx configuration templates.

Use clear bullets, tables, and distinct callouts. Provide exact Nginx or configuration adjustments when recommending updates.`;

    const userPrompt = `Project Name: ${project.name}
Framework Stack: ${project.stack}
Subdomain: ${project.subdomain}
Active Telemetry Snapshot:
- Total Traffic: ${totalVisits} requests
- Average Latency: ${avgResponseTime}ms
- Critical Errors Count: ${totalErrors}
- Error Rate: ${errorRate}%
- Top Routing Endpoints Hits: ${JSON.stringify(trafficAnalytics.routes || [])}
- Recent Edge Ingress Access Logs (Last 20): ${JSON.stringify(trafficAnalytics.logs || [])}

Provide your SRE Traffic Insights audit now:`;

    const reply = await callAI(systemPrompt, userPrompt, 1200, false);
    if (!reply) {
      return res.json({
        reply: '⚠️ **AI Traffic Auditor temporarily unavailable.** Both Gemini and Groq are cooling down.\n\nPlease wait **20–30 seconds** and try again.'
      });
    }

    res.json({ reply });
  } catch (err) {
    const errMsg = err?.message || 'Unknown server error';
    if (errMsg.includes('No valid API keys')) {
      return res.json({
        reply: `## 📊 Executive Traffic Summary\n\n**AI keys not configured.** Add a free \`GEMINI_API_KEY\` to your \`server/.env\` to unlock real-time SRE traffic analysis.\n\n**Quick Start:** Visit [Google AI Studio](https://aistudio.google.com) to generate a free key.`
      });
    }
    res.status(500).json({ message: errMsg });
  }
};

const commitReadme = async (req, res) => {
  try {
    const Project = require('../models/Project.model');
    const project = await Project.findOne({
      _id: req.params.id,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const path = require('path');
    const fs = require('fs');
    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    const readmePath = path.join(repoPath, 'README.md');
    if (!fs.existsSync(readmePath)) {
      return res.status(400).json({ message: 'No generated README found. Generate it first.' });
    }

    const { exec } = require('child_process');
    const execPromise = (cmd, options) => new Promise((resolve, reject) => {
      exec(cmd, options, (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout, stderr });
      });
    });

    // 1. Get authenticated git URL (with token injection)
    const User = require('../models/User.model');
    const owner = await User.findById(project.owner);
    const githubService = require('../services/github.service');
    const token = await githubService.ensureValidGithubToken(owner);

    const authedUrl = `https://x-access-token:${token}@github.com/${project.repoFullName}.git`;

    // 2. Git config, commit and push
    await execPromise(`git -C "${repoPath}" config user.name "LaunchLive AI"`);
    await execPromise(`git -C "${repoPath}" config user.email "ai@launchlive.in"`);
    await execPromise(`git -C "${repoPath}" add README.md`);
    
    try {
      await execPromise(`git -C "${repoPath}" commit -m "docs: auto-generate README.md & Architecture Flow [LaunchLive AI]"`);
    } catch (commitErr) {
      if (commitErr.message.includes('nothing to commit')) {
        // do nothing
      } else {
        throw commitErr;
      }
    }

    await execPromise(`git -C "${repoPath}" push "${authedUrl}" ${project.branch || 'main'}`);

    res.json({ message: 'README.md successfully committed and pushed to GitHub!' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const debugKeys = async (req, res) => {
  try {
    const axios = require('axios');

    const results = {
      groq: [],
      gemini: []
    };

    // Scan env for Groq
    for (const key in process.env) {
      if (key.startsWith('GROQ_API_KEY')) {
        const val = process.env[key] || '';
        const isPlural = key === 'GROQ_API_KEYS';
        const rawKeys = isPlural ? val.split(',') : [val];
        
        for (const k of rawKeys) {
          const trimmed = k.trim();
          if (!trimmed || trimmed === 'placeholder') continue;
          
          let status = 'Unknown';
          let errorMsg = null;
          
          try {
            await axios.post(
              'https://api.groq.com/openai/v1/chat/completions',
              {
                model: 'llama-3.3-70b-versatile',
                messages: [{ role: 'user', content: 'respond with ok' }]
              },
              {
                headers: { Authorization: `Bearer ${trimmed}` },
                timeout: 5000
              }
            );
            status = 'VALID';
          } catch (err) {
            status = err.response?.status || 'Error';
            errorMsg = err.response?.data?.error?.message || err.message;
          }
          
          results.groq.push({
            envVar: key,
            keyLength: trimmed.length,
            obfuscated: trimmed.length > 10 ? `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}` : 'too-short',
            status,
            errorMsg
          });
        }
      }
    }

    // Scan env for Gemini
    for (const key in process.env) {
      if (key.startsWith('GEMINI_API_KEY')) {
        const val = process.env[key] || '';
        const isPlural = key === 'GEMINI_API_KEYS';
        const rawKeys = isPlural ? val.split(',') : [val];
        
        for (const k of rawKeys) {
          const trimmed = k.trim();
          if (!trimmed || trimmed === 'placeholder') continue;
          
          let status = 'Unknown';
          let errorMsg = null;
          
          try {
            await axios.post(
              `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${trimmed}`,
              {
                contents: [{ parts: [{ text: 'respond with ok' }] }]
              },
              {
                timeout: 5000
              }
            );
            status = 'VALID';
          } catch (err) {
            status = err.response?.status || 'Error';
            errorMsg = err.response?.data?.error?.message || err.message;
          }
          
          results.gemini.push({
            envVar: key,
            keyLength: trimmed.length,
            obfuscated: trimmed.length > 10 ? `${trimmed.slice(0, 8)}...${trimmed.slice(-6)}` : 'too-short',
            status,
            errorMsg
          });
        }
      }
    }

    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getVpsLogs = async (req, res) => {
  try {
    const { exec } = require('child_process');
    const homedir = require('os').homedir();
    const path = require('path');
    const fs = require('fs');

    const fallbackErrLog = path.join(homedir, '.pm2/logs/launchpad-server-error.log');
    const fallbackOutLog = path.join(homedir, '.pm2/logs/launchpad-server-out.log');

    exec('pm2 jlist', (err, stdout, stderr) => {
      let errLog = fallbackErrLog;
      let outLog = fallbackOutLog;

      if (!err && stdout) {
        try {
          const apps = JSON.parse(stdout);
          const app = apps.find(a => a.name === 'launchpad-server');
          if (app) {
            errLog = app.pm2_env.pm_err_log_path || fallbackErrLog;
            outLog = app.pm2_env.pm_out_log_path || fallbackOutLog;
          }
        } catch (e) {}
      }

      // Read logs memory-safely using tail
      let logs = '';
      const readLogFile = (filePath, label) => {
        return new Promise((resolve) => {
          if (!fs.existsSync(filePath)) {
            return resolve(`--- ${label} (${filePath}) ---\nFile does not exist.\n\n`);
          }
          exec(`tail -n 150 "${filePath}"`, { timeout: 5000 }, (tailErr, tailStdout) => {
            resolve(`--- ${label} (${filePath}) ---\n${tailStdout || 'Empty or failed to read.'}\n\n`);
          });
        });
      };

      Promise.all([
        readLogFile(errLog, 'ERROR LOG'),
        readLogFile(outLog, 'OUT LOG')
      ]).then((results) => {
        res.json({ logs: results.join('') });
      });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  chatWithAI,
  suggestFix,
  optimizeConfig,
  discoverEnv,
  inspectLogs,
  optimizeDbQueries,
  predictResources,
  generateDocs,
  commitReadme,
  auditSecurity,
  devopsSummary,
  analyzeTrafficInsights,
  debugKeys,
  getVpsLogs,
};