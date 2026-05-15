const axios = require('axios');

// ─── AI API Callers ───────────────────────────────────────────────────────────

const callGroq = async (systemPrompt, userPrompt, maxTokens = 512, isJson = false) => {
  if (!process.env.GROQ_API_KEY) throw new Error('Groq API Key missing');
  
  const payload = {
    model: 'llama-3.3-70b-versatile',
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
  };

  // Enforce structured JSON output if requested
  if (isJson) {
    payload.response_format = { type: 'json_object' };
  }

  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    payload,
    {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
    }
  );
  return res.data.choices[0].message.content;
};

const callGemini = async (systemPrompt, userPrompt, maxTokens = 512, isJson = false) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API Key missing');
  
  const payload = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts: [{ text: userPrompt }] }],
    generationConfig: {
      maxOutputTokens: maxTokens,
    }
  };

  if (isJson) {
    payload.generationConfig.responseMimeType = 'application/json';
  }

  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    payload,
    { headers: { 'Content-Type': 'application/json' } }
  );
  return res.data.candidates[0].content.parts[0].text;
};

// Failover logic: Try Groq first, then Gemini
const callAI = async (systemPrompt, userPrompt, maxTokens = 512, isJson = false) => {
  try {
    return await callGroq(systemPrompt, userPrompt, maxTokens, isJson);
  } catch (groqErr) {
    console.error(`[AI Fallback] Groq failed (${groqErr.message}). Trying Gemini...`);
    try {
      return await callGemini(systemPrompt, userPrompt, maxTokens, isJson);
    } catch (geminiErr) {
      console.error(`[AI Fallback] Gemini also failed (${geminiErr.message}).`);
      return null;
    }
  }
};

// ─── Feature Functions ────────────────────────────────────────────────────────

// Called when a build fails — returns a plain-English explanation
const analyzeError = async (logs, stack = 'unknown') => {
  const systemPrompt = `You are an expert deployment assistant for a platform called LaunchPad.
Analyze the build logs and respond strictly in 3-5 plain-text sentences.
1. State exactly what went wrong (be specific — missing package, syntax error, wrong Node version, etc.)
2. Tell the user what file or line to look at if relevant.
3. Give the exact fix they should apply.
DO NOT use Markdown, bolding, code blocks, or filler words. Be direct.`;

  // Safely handle log inputs
  const safeLogs = (typeof logs === 'string' ? logs : String(logs || '')).slice(-3000);
  
  const userPrompt = `A user's ${stack} app just failed to build. Here are the raw logs:\n\n${safeLogs}`;

  const response = await callAI(systemPrompt, userPrompt, 512, false);
  
  // Return a safe string if AI is entirely down
  return response || "We couldn't analyze the build logs at this time. Please review the raw output above for details.";
};

// Called on project creation — uses AI to improve stack detection
const detectStackWithAI = async (fileList, packageJsonContent) => {
  const systemPrompt = `You are a stack detection API. 
Analyze the repository files and package.json contents.
Return a valid JSON object with a single key "stack" containing one of these exact string values: "react", "node", "mern", "static", "next", "nuxt", or "unknown".
Do not return anything else.`;

  // Safely serialize inputs to prevent slice/join crashes
  const safeFiles = Array.isArray(fileList) ? fileList.slice(0, 50).join(', ') : '';
  const safePkg = typeof packageJsonContent === 'object' 
    ? JSON.stringify(packageJsonContent).slice(0, 500) 
    : String(packageJsonContent || '').slice(0, 500);

  const userPrompt = `Files: ${safeFiles}\nPackage.json: ${safePkg}`;

  const response = await callAI(systemPrompt, userPrompt, 150, true); // isJson = true
  if (!response) return 'unknown';

  try {
    const parsed = JSON.parse(response);
    const stack = (parsed.stack || '').trim().toLowerCase();
    
    const validStacks = ['react', 'node', 'mern', 'static', 'next', 'nuxt'];
    return validStacks.includes(stack) ? stack : 'unknown';
  } catch (error) {
    console.error('[AI Detection Error] Failed to parse JSON response:', error.message);
    return 'unknown';
  }
};

module.exports = { analyzeError, detectStackWithAI };