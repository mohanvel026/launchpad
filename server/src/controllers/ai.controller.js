const axios      = require('axios');
const Project    = require('../models/Project.model');
const Deployment = require('../models/Deployment.model');

// Helper function to call AI with automatic fallback
const generateAIResponse = async (systemPrompt, userMessage, history = []) => {
  const hasGemini = process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'placeholder';
  const hasGroq   = process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'placeholder';

  if (!hasGemini && !hasGroq) {
    throw new Error('No valid API keys found. Please add GEMINI_API_KEY or GROQ_API_KEY to your .env');
  }

  // 1. Try Gemini
  if (hasGemini) {
    try {
      const contents = history.map(h => ({
        role: h.role === 'user' ? 'user' : 'model',
        parts: [{ text: h.content }]
      }));
      contents.push({ role: 'user', parts: [{ text: `System Instruction: ${systemPrompt}\n\nUser Question: ${userMessage}` }] });

      const res = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { contents }
      );
      return res.data.candidates[0].content.parts[0].text;
    } catch (err) {
      console.warn('Gemini failed, falling back to Groq...', err.message);
      if (!hasGroq) throw err;
    }
  }

  // 2. Try Groq (Fallback or Primary if Gemini missing)
  if (hasGroq) {
    const messages = [{ role: 'system', content: systemPrompt }];
    history.forEach(h => messages.push({ role: h.role, content: h.content }));
    messages.push({ role: 'user', content: userMessage });

    const res = await axios.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: 'llama3-8b-8192',
        messages,
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );
    return res.data.choices[0].message.content;
  }
};

// POST /api/ai/:projectId/chat
const chatWithAI = async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ message: 'message is required' });

  try {
    const project = await Project.findOne({ _id: req.params.projectId, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const latestDeploy = await Deployment.findOne({ project: project._id }).sort({ createdAt: -1 }).select('status commitMessage aiErrorSummary logs duration stack');
    const systemPrompt = `You are a DevOps assistant. Project: ${project.name}, Stack: ${project.stack}. Status: ${project.status}. Latest Deploy Status: ${latestDeploy?.status}. Be concise and technical.`;

    const reply = await generateAIResponse(systemPrompt, message, history);
    res.json({ reply });
  } catch (err) {
    console.error('AI chat error:', err.message);
    if (err.message.includes('No valid API keys')) {
      return res.json({ reply: "Sorry, I can't analyze your logs right now! 🤖\n\nTo activate me, you need to add a `GEMINI_API_KEY` or `GROQ_API_KEY` to your `/home/ubuntu/launchpad/server/.env` file and restart the server.\n\n*(Tip: Both are completely FREE!)*" });
    }
    res.status(500).json({ message: 'AI assistant unavailable: ' + err.message });
  }
};

// POST /api/ai/:projectId/suggest-fix
const suggestFix = async (req, res) => {
  try {
    const project = await Project.findOne({ _id: req.params.projectId, $or: [{ owner: req.user._id }, { collaborators: req.user._id }] });
    if (!project) return res.status(404).json({ message: 'Project not found' });

    const latestDeploy = await Deployment.findOne({ project: project._id }).sort({ createdAt: -1 });
    if (!latestDeploy) return res.json({ suggestion: 'No deployments found to analyze.' });
    if (latestDeploy.status === 'failed' && latestDeploy.aiErrorSummary) return res.json({ suggestion: latestDeploy.aiErrorSummary });

    const fs = require('fs'); const path = require('path');
    let fileStructure = 'Unable to read files';
    try { const repoPath = path.join(process.env.REPOS_DIR || '/var/launchpad/repos', project._id.toString()); if (fs.existsSync(repoPath)) { fileStructure = fs.readdirSync(repoPath).join(', '); } } catch (e) {}

    const logs = latestDeploy.logs?.slice(-20).join('\n') || 'No logs available';
    const prompt = `You are a DevOps AI assistant. A user deployed a ${project.stack} app. \nThe build status was: ${latestDeploy.status}.\n\nRecent Logs:\n${logs}\n\nFiles Found:\n${fileStructure}\n\nDiagnose the error. Give a 2-3 sentence technical fix.`;

    const suggestion = await generateAIResponse('You are an expert DevOps engineer diagnosing build failures.', prompt);
    await Deployment.findByIdAndUpdate(latestDeploy._id, { aiErrorSummary: suggestion });
    res.json({ suggestion });
  } catch (err) { 
    if (err.message.includes('No valid API keys')) {
      return res.json({ suggestion: "To use the AI Diagnostic tool, add a free `GEMINI_API_KEY` or `GROQ_API_KEY` to your `.env` file!" });
    }
    res.status(500).json({ message: err.message }); 
  }
};

module.exports = { chatWithAI, suggestFix };