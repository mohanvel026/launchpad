const axios      = require('axios');
const Project    = require('../models/Project.model');
const Deployment = require('../models/Deployment.model');

// POST /api/ai/:projectId/chat
// AI deployment assistant — answers questions about the user's specific deployment
const chatWithAI = async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ message: 'message is required' });

  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    // Get latest deployment for context
    const latestDeploy = await Deployment.findOne({ project: project._id })
      .sort({ createdAt: -1 })
      .select('status commitMessage aiErrorSummary logs duration stack');

    // Build context about the user's project
    const systemPrompt = `You are a helpful deployment assistant for LaunchPad, a fullstack app deployment platform.

You are helping the user with their project called "${project.name}".
- Repo: ${project.repoFullName}
- Stack: ${project.stack || 'unknown'}
- Status: ${project.status}
- Branch: ${project.branch}
- Subdomain: ${project.subdomain ? `${project.subdomain}.launchpad.dev` : 'not deployed yet'}
${latestDeploy ? `
Latest deployment:
- Status: ${latestDeploy.status}
- Commit: ${latestDeploy.commitMessage || 'unknown'}
- Duration: ${latestDeploy.duration ? `${(latestDeploy.duration/1000).toFixed(1)}s` : 'unknown'}
${latestDeploy.aiErrorSummary ? `- Last error: ${latestDeploy.aiErrorSummary}` : ''}
` : '- No deployments yet'}

Answer questions about:
- Deployment errors and how to fix them
- How to configure environment variables
- How to set up a custom domain
- How to optimize their app for deployment
- General MERN/Node/React deployment questions

Be concise, technical, and helpful. If you don't know something specific about their setup, say so.
Never make up deployment logs or error messages you don't have.`;

    // Build conversation history for Claude
    const messages = [
      ...history.slice(-6).map((h) => ({ role: h.role, content: h.content })),
      { role: 'user', content: message },
    ];

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 1024,
        system:     systemPrompt,
        messages,
      },
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json',
        },
      }
    );

    const reply = response.data.content[0].text;
    res.json({ reply });
  } catch (err) {
    console.error('AI chat error:', err.message);
    res.status(500).json({ message: 'AI assistant unavailable: ' + err.message });
  }
};

// POST /api/ai/:projectId/suggest-fix
// Suggest a fix for the latest failed deployment
const suggestFix = async (req, res) => {
  try {
    const project = await Project.findOne({
      _id: req.params.projectId,
      $or: [{ owner: req.user._id }, { collaborators: req.user._id }],
    });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const failedDeploy = await Deployment.findOne({
      project: project._id,
      status:  'failed',
    }).sort({ createdAt: -1 });

    if (!failedDeploy) {
      return res.json({ suggestion: 'No failed deployments found. Your app is deploying successfully!' });
    }

    if (failedDeploy.aiErrorSummary) {
      return res.json({ suggestion: failedDeploy.aiErrorSummary });
    }

    // Generate fresh analysis
    const logs = failedDeploy.logs?.slice(-20).join('\n') || 'No logs available';
    const prompt = `A ${project.stack} app failed to deploy. Last 20 log lines:

${logs}

Give a 2-3 sentence diagnosis and exact fix. Be specific and technical.`;

    const response = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages:   [{ role: 'user', content: prompt }],
      },
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type':      'application/json',
        },
      }
    );

    const suggestion = response.data.content[0].text;
    await Deployment.findByIdAndUpdate(failedDeploy._id, { aiErrorSummary: suggestion });
    res.json({ suggestion });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { chatWithAI, suggestFix };