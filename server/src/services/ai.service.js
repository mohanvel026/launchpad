const axios = require('axios');

const callGroq = async (prompt, maxTokens = 512) => {
  if (!process.env.GROQ_API_KEY) throw new Error('Groq API Key missing');
  const res = await axios.post(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      model:      'llama-3.3-70b-versatile',
      max_tokens: maxTokens,
      messages:   [{ role: 'user', content: prompt }],
    },
    {
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type':  'application/json',
      },
    }
  );
  return res.data.choices[0].message.content;
};

const callGemini = async (prompt, maxTokens = 512) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API Key missing');
  const res = await axios.post(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      contents: [{
        parts: [{ text: prompt }]
      }],
      generationConfig: {
        maxOutputTokens: maxTokens
      }
    },
    { headers: { 'Content-Type': 'application/json' } }
  );
  return res.data.candidates[0].content.parts[0].text;
};

// Failover logic: Try Groq first, then Gemini
const callAI = async (prompt, maxTokens = 512) => {
  try {
    return await callGroq(prompt, maxTokens);
  } catch (groqErr) {
    console.error('Groq failed, falling back to Gemini:', groqErr.message);
    try {
      return await callGemini(prompt, maxTokens);
    } catch (geminiErr) {
      console.error('Gemini also failed:', geminiErr.message);
      return null;
    }
  }
};

// Called when a build fails — returns a plain-English explanation
const analyzeError = async (logs, stack = 'unknown') => {
  const prompt = `You are a deployment assistant for a platform called LaunchPad.
A user's ${stack} app just failed to build. Here are the raw build logs:

\`\`\`
${logs.slice(-3000)}   
\`\`\`

In 3-5 sentences:
1. State exactly what went wrong (be specific — missing package, syntax error, wrong Node version, etc.)
2. Tell the user what file or line to look at if relevant
3. Give the exact fix they should apply

Be direct and technical. No filler. Respond in plain text, no markdown.`;

  return await callAI(prompt, 512);
};

// Called on project creation — uses AI to improve stack detection when heuristics are uncertain
const detectStackWithAI = async (fileList, packageJsonContent) => {
  const prompt = `Given these files in a repo: ${fileList.slice(0, 50).join(', ')}
And this package.json: ${packageJsonContent?.slice(0, 500) || 'not found'}

Respond with exactly one word — the stack type:
- react   (frontend only, React/Vite/CRA)
- node    (backend only, Express/Fastify)
- mern    (fullstack, React + Express + MongoDB)
- static  (plain HTML/CSS/JS, no Node)
- unknown (cannot determine)

One word only. No explanation.`;

  const response = await callAI(prompt, 10);
  if (!response) return 'unknown';
  
  const word = response.trim().toLowerCase();
  const valid = ['react', 'node', 'mern', 'static'];
  return valid.includes(word) ? word : 'unknown';
};

module.exports = { analyzeError, detectStackWithAI };