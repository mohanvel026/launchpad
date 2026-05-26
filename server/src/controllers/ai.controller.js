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
    const systemPrompt = `You are LaunchPad DevOps AI, an elite cloud systems expert.
Context:
- Project Name: ${project.name}
- Current Framework/Stack: ${project.stack}
- Project Active Status: ${project.status}
- Latest Deployment: ${latestDeploy ? `${latestDeploy.status} (${latestDeploy.commitMessage || 'No msg'})` : 'None'}

Your tone should be highly professional, technical, direct, and helpful. Always provide actionable tips, commands, or config templates when asked.
If analyzing build logs, focus strictly on the root cause and remediation.`;

    // Map frontend chat history format to standard user/system prompts
    const chatHistory = history.map(h => `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`).join('\n');
    const userPromptWithHistory = `${chatHistory}\nUser: ${message}`;

    const reply = await callAI(systemPrompt, userPromptWithHistory, 800, false);
    if (!reply) throw new Error('AI service failed to respond.');

    res.json({ reply });
  } catch (err) {
    console.error('[AI Chat Error]:', err.message);
    if (err.message.includes('No valid API keys')) {
      return res.json({
        reply: "Sorry, I can't chat right now! 🤖\n\nTo activate me, please add a `GEMINI_API_KEY` or `GROQ_API_KEY` to your `server/.env` file and restart the server.\n\n*(Tip: Both are completely FREE to get!)*"
      });
    }
    res.status(500).json({ message: 'AI assistant unavailable: ' + err.message });
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

    const repoPath = path.join(process.env.REPOS_DIR || '/var/launchpad/repos', project._id.toString());
    let aggregatedCode = '';

    // Aggressive but safe scanner: read .js, .ts, .py files up to 10 files to extract process.env calls
    if (fs.existsSync(repoPath)) {
      const readFilesRecursively = (dir, depth = 0) => {
        if (depth > 3) return; // avoid deep nested structures
        const files = fs.readdirSync(dir);
        for (const file of files) {
          const fullPath = path.join(dir, file);
          if (fs.statSync(fullPath).isDirectory()) {
            if (file !== 'node_modules' && file !== '.git' && file !== 'dist') {
              readFilesRecursively(fullPath, depth + 1);
            }
          } else if (/\.(js|ts|py|json|env|config)$/i.test(file)) {
            if (aggregatedCode.length < 15000) {
              aggregatedCode += `\n// File: ${file}\n` + fs.readFileSync(fullPath, 'utf8').slice(0, 1500);
            }
          }
        }
      };
      readFilesRecursively(repoPath);
    }

    const { discoverRequiredEnvVars } = require('../services/ai.service');
    const result = await discoverRequiredEnvVars(aggregatedCode, project.stack);

    // Auto-generate and write a highly professional .env.example file to their cloned workspace
    if (result.detectedVars && result.detectedVars.length > 0 && fs.existsSync(repoPath)) {
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

    const repoPath = path.join(process.env.REPOS_DIR || '/var/launchpad/repos', project._id.toString());
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

    const repoPath = path.join(process.env.REPOS_DIR || '/var/launchpad/repos', project._id.toString());
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

module.exports = {
  chatWithAI,
  suggestFix,
  optimizeConfig,
  discoverEnv,
  inspectLogs,
  optimizeDbQueries,
  predictResources,
};