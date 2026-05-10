const axios = require('axios');

// Called when a build fails — sends the error logs to Claude and returns a plain-English explanation
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

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 512,
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
    return res.data.content[0].text;
  } catch (err) {
    console.error('AI analysis error:', err.message);
    return null;
  }
};

// Called on project creation — uses Claude to improve stack detection when heuristics are uncertain
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

  try {
    const res = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model:      'claude-sonnet-4-20250514',
        max_tokens: 10,
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
    const word = res.data.content[0].text.trim().toLowerCase();
    const valid = ['react', 'node', 'mern', 'static'];
    return valid.includes(word) ? word : 'unknown';
  } catch (err) {
    console.error('AI stack detection error:', err.message);
    return 'unknown';
  }
};

module.exports = { analyzeError, detectStackWithAI };