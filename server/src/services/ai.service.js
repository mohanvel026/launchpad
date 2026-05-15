const axios = require('axios');

// ─── Configuration & Constants ────────────────────────────────────────────────
const CONFIG = {
  GROQ_MODEL: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  TIMEOUT_MS: parseInt(process.env.AI_TIMEOUT_MS, 10) || 20000, // 20-second strict timeout
  MAX_LOG_CHARS: 4000,
  MAX_PKG_CHARS: 1000,
};

// Create pre-configured Axios instances for resilience
const httpClient = axios.create({
  timeout: CONFIG.TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// Helper to extract meaningful error messages from Axios
const formatApiError = (provider, error) => {
  if (error.response) {
    return `[${provider} HTTP ${error.response.status}] ${JSON.stringify(error.response.data)}`;
  }
  if (error.code === 'ECONNABORTED') return `[${provider}] Request timed out after ${CONFIG.TIMEOUT_MS}ms`;
  return `[${provider}] ${error.message}`;
};

// ─── AI API Callers ───────────────────────────────────────────────────────────

const callGroq = async (systemPrompt, userPrompt, maxTokens = 512, isJson = false) => {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is not configured.');

  const payload = {
    model: CONFIG.GROQ_MODEL,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    ...(isJson && { response_format: { type: 'json_object' } })
  };

  const res = await httpClient.post(
    'https://api.groq.com/openai/v1/chat/completions',
    payload,
    { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
  );

  return res.data.choices[0].message.content;
};

const callGemini = async (systemPrompt, userPrompt, maxTokens = 512, isJson = false) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not configured.');

  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
      ...(isJson && { responseMimeType: 'application/json' })
    }
  };

  const res = await httpClient.post(
    `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    payload
  );

  return res.data.candidates[0].content.parts[0].text;
};

// ─── Orchestration & Failover ─────────────────────────────────────────────────

const callAI = async (systemPrompt, userPrompt, maxTokens = 512, isJson = false) => {
  try {
    return await callGroq(systemPrompt, userPrompt, maxTokens, isJson);
  } catch (groqErr) {
    const groqStatus = groqErr.response?.status;
    console.warn(formatApiError('Groq', groqErr));

    // Do not failover if the error is a 400 (Bad Request/Validation Error).
    // The prompt is likely flawed, and Gemini will probably reject it too.
    if (groqStatus >= 400 && groqStatus < 500 && groqStatus !== 429) {
      console.error('[AI Routing] Unrecoverable client error. Aborting failover.');
      return null;
    }

    console.info('[AI Routing] Failing over to Gemini...');
    try {
      return await callGemini(systemPrompt, userPrompt, maxTokens, isJson);
    } catch (geminiErr) {
      console.error(formatApiError('Gemini', geminiErr));
      return null;
    }
  }
};

// ─── Feature Functions ────────────────────────────────────────────────────────

/**
 * Analyzes build logs and returns a plain-English explanation.
 * @param {string} logs - The raw build output.
 * @param {string} [stack='unknown'] - The framework/stack being deployed.
 * @returns {Promise<string>} A 3-5 sentence explanation or a safe fallback string.
 */
const analyzeError = async (logs, stack = 'unknown') => {
  const systemPrompt = `You are an expert deployment assistant for a platform called LaunchPad.
Analyze the build logs and respond strictly in 3-5 plain-text sentences.
1. State exactly what went wrong (be specific — missing package, syntax error, wrong Node version, etc.)
2. Tell the user what file or line to look at if relevant.
3. Give the exact fix they should apply.
DO NOT use Markdown, bolding, code blocks, or filler words. Be direct.`;

  // Safely truncate logs to prevent token-limit exceptions
  const safeLogs = (typeof logs === 'string' ? logs : String(logs || '')).slice(-CONFIG.MAX_LOG_CHARS);
  const userPrompt = `A user's ${stack} app just failed to build. Here are the raw logs:\n\n${safeLogs}`;

  const response = await callAI(systemPrompt, userPrompt, 512, false);
  
  return response?.trim() || "We couldn't analyze the build logs at this time. Please review the raw output above for details.";
};

/**
 * Detects the project stack based on repository files and package.json.
 * @param {string[]} fileList - Array of filenames in the root directory.
 * @param {string|object} packageJsonContent - The contents of the package.json file.
 * @returns {Promise<string>} The detected stack identifier.
 */
const detectStackWithAI = async (fileList, packageJsonContent) => {
  const systemPrompt = `You are a stack detection API. 
Analyze the repository files and package.json contents.
Return a valid JSON object with a single key "stack" containing one of these exact string values: "react", "node", "mern", "static", "next", "nuxt", or "unknown".
Do not return anything else.`;

  // Safely serialize inputs to prevent slice/join crashes or massive token usage
  const safeFiles = Array.isArray(fileList) ? fileList.slice(0, 100).join(', ') : '';
  const safePkg = typeof packageJsonContent === 'object' 
    ? JSON.stringify(packageJsonContent).slice(0, CONFIG.MAX_PKG_CHARS) 
    : String(packageJsonContent || '').slice(0, CONFIG.MAX_PKG_CHARS);

  const userPrompt = `Files: ${safeFiles}\nPackage.json: ${safePkg}`;

  const response = await callAI(systemPrompt, userPrompt, 150, true);
  if (!response) return 'unknown';

  try {
    const parsed = JSON.parse(response);
    const stack = (parsed?.stack || '').trim().toLowerCase();
    
    const validStacks = new Set(['react', 'node', 'mern', 'static', 'next', 'nuxt']);
    return validStacks.has(stack) ? stack : 'unknown';
  } catch (error) {
    console.error('[AI Detection Error] Failed to parse JSON response:', error.message, 'Raw Response:', response);
    return 'unknown';
  }
};

module.exports = { analyzeError, detectStackWithAI };