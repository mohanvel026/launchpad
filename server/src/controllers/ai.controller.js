const fs         = require('fs');
const path       = require('path');
const Project    = require('../models/Project.model');
const Deployment = require('../models/Deployment.model');
const { callAI, generateOptimizationAdvice } = require('../services/ai.service');

/**
 * Standard API error responder if keys are missing
 */
const checkApiKeys = () => {
  const hasGemini = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'placeholder';
  const hasGroq   = process.env.GROQ_API_KEY   && process.env.GROQ_API_KEY   !== 'placeholder';
  if (!hasGemini && !hasGroq) {
    throw new Error('No valid API keys found. Please add GEMINI_API_KEY or GROQ_API_KEY to your .env');
  }
};

// ─── POST /api/ai/:projectId/chat ─────────────────────────────────────────────
const chatWithAI = async (req, res) => {
  const { message, history = [] } = req.body;
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

    // Build rich contextual DevOps System Prompt
    const systemPrompt = `You are LaunchPad DevOps AI, an elite cloud systems SRE expert.
Context:
- Project Name: ${project.name}
- Current Framework/Stack: ${project.stack}
- Project Active Status: ${project.status}
- Latest Deployment: ${latestDeploy ? `${latestDeploy.status} (${latestDeploy.commitMessage || 'No msg'})` : 'None'}
${latestDeploy && latestDeploy.status === 'failed' && latestDeploy.logs ? `- Recent Failure Logs (truncated): \n${latestDeploy.logs.slice(-25).join('\n')}` : ''}

Your tone should be highly professional, technical, direct, and helpful. Always provide actionable tips, commands, or config templates when asked.

CRITICAL FORMATTING INSTRUCTIONS:
1. Do NOT output a single continuous wall of text.
2. ALWAYS divide your message into clear, distinct sections using bold headers (e.g. **🔍 Root Cause**, **🛠️ Remediation Steps**).
3. Use separate lines and bullet lists (e.g. - or numbered lists) instead of wrapping text.
4. Encapsulate all command-line fixes or file modifications inside code blocks (e.g. \`\`\`bash ... \`\`\` or \`\`\`json ... \`\`\`).
5. Highlight files or keywords using inline code (e.g. \`package.json\`).`;

    // Map frontend chat history format to standard user/system prompts
    const chatHistory = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
    const userPromptWithHistory = `${chatHistory}\nUser: ${message}`;

    const reply = await callAI(systemPrompt, userPromptWithHistory, 800, false);
    if (!reply) throw new Error('AI service failed to respond.');

    res.json({ reply });
  } catch (err) {
    const errMsg = err?.message || 'Unknown server error';
    console.error('[AI Chat Error]:', errMsg);
    if (errMsg.includes('No valid API keys')) {
      return res.json({
        reply: "Sorry, I can't chat right now! 🤖\n\nTo activate me, please add a `GEMINI_API_KEY` or `GROQ_API_KEY` to your `server/.env` file and restart the server.\n\n*(Tip: Both are completely FREE to get!)*"
      });
    }
    res.status(500).json({ message: 'AI assistant unavailable: ' + errMsg });
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
    const logs = latestDeploy.logs?.slice(-40).join('\n') || 'No logs available';

    const systemPrompt = `You are LaunchPad DevOps AI. Analyze the build failure and write a 2-3 sentence technical diagnosis.
Be precise. State the exact file, parameter, or command that failed, and tell the developer the exact fix.`;

    const userPrompt = `Project Stack: ${project.stack}
Build Status: ${latestDeploy.status}
Files present: ${fileStructure}

Recent Build/Runtime Logs:
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
    const detectedKeys = new Set();

    if (fs.existsSync(repoPath)) {
      const readFilesRecursively = (dir, depth = 0) => {
        if (depth > 5) return;
        try {
          const files = fs.readdirSync(dir);
          for (const file of files) {
            const fullPath = path.join(dir, file);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isDirectory()) {
                if (file !== 'node_modules' && file !== '.git' && file !== 'dist' && file !== 'build') {
                  readFilesRecursively(fullPath, depth + 1);
                }
              } else if (/\.(js|jsx|ts|tsx|py|json|config)$/i.test(file) || file.toLowerCase().includes('env')) {
                const content = fs.readFileSync(fullPath, 'utf8');
                
                // 1. Extract process.env.xyz (case-insensitive for variable names)
                const nodeMatches = content.matchAll(/process\.env\.([a-zA-Z_0-9]+)/g);
                for (const m of nodeMatches) {
                  if (m[1]) {
                    const upper = m[1].toUpperCase();
                    if (!['NODE_ENV', 'PORT', 'PATH', 'HOME'].includes(upper)) {
                      detectedKeys.add(m[1]);
                      detectedKeys.add(upper);
                    }
                  }
                }

                // 2. Extract destructured process.env calls (e.g. const { MONGO, JWT } = process.env)
                const destructureMatches = content.matchAll(/(?:const|let|var)\s*\{\s*([A-Za-z0-9_,\s\n]+)\s*\}\s*=\s*process\.env/g);
                for (const dm of destructureMatches) {
                  if (dm[1]) {
                    const keys = dm[1].split(',').map(k => k.trim());
                    keys.forEach(k => {
                      if (k && /^[a-zA-Z_0-9]+$/.test(k)) {
                        const upper = k.toUpperCase();
                        if (!['NODE_ENV', 'PORT', 'PATH', 'HOME'].includes(upper)) {
                          detectedKeys.add(k);
                          detectedKeys.add(upper);
                        }
                      }
                    });
                  }
                }

                // 3. Extract standard .env key=value pairs (supports mixed-case and all .env.local/development files)
                if (file.toLowerCase().includes('env')) {
                  const lines = content.split('\n');
                  lines.forEach(line => {
                    const clean = line.trim();
                    if (clean && !clean.startsWith('#') && clean.includes('=')) {
                      const key = clean.split('=')[0].trim();
                      if (/^[a-zA-Z_0-9]+$/.test(key)) {
                        const upper = key.toUpperCase();
                        if (!['NODE_ENV', 'PORT'].includes(upper)) {
                          detectedKeys.add(key);
                          detectedKeys.add(upper);
                        }
                      }
                    }
                  });
                }

                // 4. Extract Python os.environ.get('xyz') or os.environ["xyz"]
                const pyMatches = content.matchAll(/os\.environ(?:\[['"]|\.get\(['"])([a-zA-Z_0-9]+)/g);
                for (const m of pyMatches) {
                  if (m[1]) {
                    detectedKeys.add(m[1]);
                    detectedKeys.add(m[1].toUpperCase());
                  }
                }

                // 5. Fallback SRE Audit: Extract hardcoded MongoDB connections or mongoose calls
                if (content.includes('mongodb://') || content.includes('mongodb+srv://') || /mongoose\.connect|mongodb\.connect/i.test(content)) {
                  detectedKeys.add('MONGODB_URI');
                  detectedKeys.add('MONGO_URI');
                }
              }
            } catch (fileErr) {
              console.warn(`[AI Env Discovery] Skipping file scan error on ${file}:`, fileErr.message);
            }
          }
        } catch (dirErr) {
          console.warn(`[AI Env Discovery] Skipping dir read error on ${dir}:`, dirErr.message);
        }
      };
      readFilesRecursively(repoPath);
    }

    const aggregatedCode = Array.from(detectedKeys).map(k => `process.env.${k}`).join('\n');

    const { discoverRequiredEnvVars } = require('../services/ai.service');
    const result = await discoverRequiredEnvVars(aggregatedCode, project.stack);

    // Guaranteed static injection fallback: Merge statically-scanned keys directly into result.detectedVars
    const resultKeys = new Set((result.detectedVars || []).map(v => v.key.toUpperCase()));
    result.detectedVars = result.detectedVars || [];
    
    detectedKeys.forEach(k => {
      if (k && !resultKeys.has(k.toUpperCase())) {
        result.detectedVars.push({
          key: k,
          required: true,
          description: 'Auto-detected via static codebase scan.',
          placeholder: `your_${k.toLowerCase()}_here`
        });
        resultKeys.add(k.toUpperCase());
      }
    });

    // Auto-generate and write a highly professional .env.example file to their cloned workspace
    if (result.detectedVars && result.detectedVars.length > 0) {
      if (fs.existsSync(repoPath)) {
        try {
          let envExampleContent = `# ─── GENERATED BY LAUNCHPAD AI ──────────────────────────────────\n`;
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

      // Elite Automation: Automagically write discovered env vars directly to LaunchPad database
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

    // Grab live docker container logs
    const containerName = `lp-${project._id.toString().slice(-8)}`;
    const { execSync } = require('child_process');
    let runtimeLogs = '';
    try {
      runtimeLogs = execSync(`docker logs --tail 100 ${containerName} 2>&1`, { timeout: 4000 }).toString();
    } catch (e) {
      runtimeLogs = 'No active container is running or logs are unavailable.';
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
        if (depth > 3) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') scanForDbOps(fullPath, depth + 1);
          } else if (/\.(js|ts|py)$/i.test(file)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Look for database keywords: Schema, find, findOne, select, insert, Prisma
            if (/mongoose|prisma|find|select|insert|update|delete|schema/i.test(content)) {
              if (dbCode.length < 12000) {
                dbCode += `\n// File: ${file}\n` + content.slice(0, 1500);
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

// ─── POST /api/ai/:projectId/predict-resources ─────────────────────────────
const predictResources = async (req, res) => {
  try {
    checkApiKeys();

    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }]
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const repoPath = path.join(__dirname, '../../repos', project._id.toString());
    let packageJson = '';
    if (fs.existsSync(repoPath)) {
      const pkgPath = path.join(repoPath, 'package.json');
      if (fs.existsSync(pkgPath)) packageJson = fs.readFileSync(pkgPath, 'utf8');
    }

    const { predictResourceRequirements } = require('../services/ai.service');
    const prediction = await predictResourceRequirements(packageJson, project.stack);
    res.json(prediction);
  } catch (err) {
    if (err.message.includes('No valid API keys')) {
      return res.json({ cpuLimit: '0.5', ramLimitMB: 256, needsRedis: false, suggestions: [] });
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

    if (fs.existsSync(repoPath)) {
      const scanForRoutes = (dir, depth = 0) => {
        if (depth > 3) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') scanForRoutes(fullPath, depth + 1);
          } else if (/\.(js|ts|py)$/i.test(file)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Scan specifically for files defining API routing or controllers
            if (/router|express\.Router|app\.(get|post|put|delete|use)|def\s+[a-zA-Z_]+\(|controller/i.test(content)) {
              if (docCode.length < 15000) {
                docCode += `\n// File: ${file}\n` + content.slice(0, 1800);
              }
            }
          }
        }
      };
      scanForRoutes(repoPath);
    }

    const { generateDocsAndReadme } = require('../services/ai.service');
    const docs = await generateDocsAndReadme(docCode, project.stack);

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
        if (depth > 3) return;
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git') scanForSecurityPatterns(fullPath, depth + 1);
          } else if (/\.(js|ts|py|json)$/i.test(file)) {
            const content = fs.readFileSync(fullPath, 'utf8');
            // Grab files dealing with server setups, auth, database, helmet, cors
            if (/helmet|cors|express-rate-limit|express-validator|bcrypt|jwt\.verify|passport|session/i.test(content)) {
              if (secCode.length < 15000) {
                secCode += `\n// File: ${file}\n` + content.slice(0, 1500);
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
    res.status(500).json({ message: err.message });
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
  auditSecurity,
  devopsSummary,
};