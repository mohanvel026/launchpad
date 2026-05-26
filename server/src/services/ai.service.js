const axios = require('axios');

// ─── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  GROQ_MODEL:    process.env.GROQ_MODEL    || 'llama-3.3-70b-versatile',
  GEMINI_MODEL:  process.env.GEMINI_MODEL  || 'gemini-1.5-flash',
  TIMEOUT_MS:    parseInt(process.env.AI_TIMEOUT_MS, 10) || 25000,
  MAX_LOG_CHARS: 5000,
  MAX_PKG_CHARS: 1200,
  MAX_RETRIES:   2,
  RETRY_BASE_MS: 600,
};

const VALID_STACKS = new Set([
  'react', 'vue', 'svelte', 'astro', 'angular',
  'node', 'mern', 'static', 'next', 'nuxt',
  'fullstack-split', 'unknown'
]);

// ─── HTTP Client ───────────────────────────────────────────────────────────────
const httpClient = axios.create({
  timeout: CONFIG.TIMEOUT_MS,
  headers: { 'Content-Type': 'application/json' },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const formatApiError = (provider, err) => {
  if (err.response)          return `[${provider} HTTP ${err.response.status}] ${JSON.stringify(err.response.data)}`;
  if (err.code === 'ECONNABORTED') return `[${provider}] Timeout after ${CONFIG.TIMEOUT_MS}ms`;
  return `[${provider}] ${err.message}`;
};

/**
 * Token-Efficient Log Compressor
 * Filters noisy/redundant lines, keeps only actionable content.
 * Reduces token usage by up to 70% on verbose Docker build logs.
 */
const compressLogs = (raw = '', maxChars = CONFIG.MAX_LOG_CHARS) => {
  if (typeof raw !== 'string') raw = String(raw || '');

  const NOISE = [
    /^npm warn/i, /^npm notice/i, /^\s*added \d+ package/i,
    /^\s*\d+ package[s]? (are looking|found)/i,
    /^Downloading/i, /^Pulling from/i, /^Pull complete/i,
    /^Already exists/i, /^Digest:/i, /^Status:/i,
    /^\s*$/, // blank lines
  ];

  const seen = new Set();
  const filtered = raw
    .split('\n')
    .filter(line => {
      if (NOISE.some(r => r.test(line))) return false;
      const key = line.trim().slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');

  // Keep the most recent / most critical part of the logs
  return filtered.length > maxChars
    ? '...[truncated]...\n' + filtered.slice(-maxChars)
    : filtered;
};

// ─── AI API Callers with Exponential Retry ─────────────────────────────────────

const callGroq = async (systemPrompt, userPrompt, maxTokens = 600, isJson = false, attempt = 0) => {
  if (!process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY not configured.');
  try {
    const res = await httpClient.post(
      'https://api.groq.com/openai/v1/chat/completions',
      {
        model: CONFIG.GROQ_MODEL,
        max_tokens: maxTokens,
        temperature: 0.2,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        ...(isJson && { response_format: { type: 'json_object' } }),
      },
      { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } }
    );
    return res.data.choices[0].message.content;
  } catch (err) {
    // Retry on rate-limit (429) or server errors (5xx) with exponential backoff + jitter
    if (attempt < CONFIG.MAX_RETRIES && (err.response?.status === 429 || err.response?.status >= 500)) {
      const delay = CONFIG.RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(`[Groq] Retry ${attempt + 1} in ${Math.round(delay)}ms...`);
      await sleep(delay);
      return callGroq(systemPrompt, userPrompt, maxTokens, isJson, attempt + 1);
    }
    throw err;
  }
};

const callGemini = async (systemPrompt, userPrompt, maxTokens = 600, isJson = false, attempt = 0) => {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not configured.');
  try {
    const res = await httpClient.post(
      `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`,
      {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.2,
          ...(isJson && { responseMimeType: 'application/json' }),
        },
      }
    );
    return res.data.candidates[0].content.parts[0].text;
  } catch (err) {
    if (attempt < CONFIG.MAX_RETRIES && (err.response?.status === 429 || err.response?.status >= 500)) {
      const delay = CONFIG.RETRY_BASE_MS * Math.pow(2, attempt) + Math.random() * 200;
      console.warn(`[Gemini] Retry ${attempt + 1} in ${Math.round(delay)}ms...`);
      await sleep(delay);
      return callGemini(systemPrompt, userPrompt, maxTokens, isJson, attempt + 1);
    }
    throw err;
  }
};

// ─── Orchestration: Groq → Gemini Failover ────────────────────────────────────

const callAI = async (systemPrompt, userPrompt, maxTokens = 600, isJson = false) => {
  try {
    return await callGroq(systemPrompt, userPrompt, maxTokens, isJson);
  } catch (groqErr) {
    const status = groqErr.response?.status;
    console.warn(formatApiError('Groq', groqErr));

    // 400-499 errors (except 429) are client faults — failover won't help
    if (status >= 400 && status < 500 && status !== 429) {
      console.error('[AI] Unrecoverable client error, skipping failover.');
      return null;
    }

    console.info('[AI] Failing over to Gemini...');
    try {
      return await callGemini(systemPrompt, userPrompt, maxTokens, isJson);
    } catch (geminiErr) {
      console.error(formatApiError('Gemini', geminiErr));
      return null;
    }
  }
};

// ─── Feature 1: Smart Build Error Analyzer ────────────────────────────────────
/**
 * Analyzes raw build/runtime logs and returns a structured, actionable diagnosis.
 * Returns a JSON object with: { summary, cause, fix, commands[] }
 */
const analyzeError = async (logs, stack = 'unknown') => {
  const systemPrompt = `You are an expert DevOps engineer and deployment specialist for a platform called LaunchPad.
Your job is to diagnose build and runtime failures with surgical precision.

Respond ONLY with a valid JSON object using this exact schema:
{
  "summary": "One sentence: what went wrong.",
  "cause": "One sentence: the exact root cause (missing dep, wrong port, bad env var, etc.).",
  "fix": "One sentence: the exact action the developer must take.",
  "commands": ["optional shell command 1", "optional shell command 2"]
}

Rules:
- Be extremely specific. Reference exact file names, package names, line numbers if visible in logs.
- "commands" should contain ready-to-run shell commands if applicable, otherwise an empty array [].
- Do not add any markdown, explanation, or text outside the JSON object.`;

  const safeLogs = compressLogs(logs);
  const userPrompt = `Stack: ${stack}\n\nBuild/Runtime Logs:\n${safeLogs}`;

  const raw = await callAI(systemPrompt, userPrompt, 600, true);
  if (!raw) return {
    summary: 'Build analysis unavailable.',
    cause:   'Could not reach AI service.',
    fix:     'Please review the raw logs above for details.',
    commands: []
  };

  try {
    const parsed = JSON.parse(raw);
    return {
      summary:  parsed.summary  || 'Unknown error.',
      cause:    parsed.cause    || 'Unknown cause.',
      fix:      parsed.fix      || 'Review raw logs.',
      commands: Array.isArray(parsed.commands) ? parsed.commands : [],
    };
  } catch {
    // Fallback: return raw text wrapped in structure
    return {
      summary: raw.trim().slice(0, 200),
      cause:   'See summary.',
      fix:     'Review the raw logs above.',
      commands: [],
    };
  }
};

// ─── Feature 2: AI Stack Detector ─────────────────────────────────────────────
/**
 * Uses AI to detect the project stack from file list and package.json.
 * Falls back to 'unknown' on any parse or API failure.
 */
const detectStackWithAI = async (fileList, packageJsonContent) => {
  const systemPrompt = `You are a project stack detection API for a deployment platform.
Analyze the file list and package.json and determine the exact framework.

Return ONLY a valid JSON object: { "stack": "<value>", "confidence": <0-100> }

Valid stack values: "react", "vue", "svelte", "astro", "angular", "node", "mern", "static", "next", "nuxt", "fullstack-split", "unknown"

Detection rules:
- "next" if next.js dependency present
- "nuxt" if nuxt dependency present
- "astro" if astro dependency present
- "svelte" if svelte or @sveltejs/kit present
- "vue" if vue dependency present (and not nuxt)
- "angular" if @angular/core present
- "react" if react present (and not next/mern)
- "mern" if express + react both present
- "fullstack-split" if both a frontend dir (client/frontend) and backend dir (server/backend) exist
- "node" if express/fastify present without react
- "static" if only HTML/CSS/JS files, no package.json dependencies
- "unknown" if you cannot determine with confidence`;

  const safeFiles = Array.isArray(fileList) ? fileList.slice(0, 120).join(', ') : '';
  const safePkg   = typeof packageJsonContent === 'object'
    ? JSON.stringify(packageJsonContent).slice(0, CONFIG.MAX_PKG_CHARS)
    : String(packageJsonContent || '').slice(0, CONFIG.MAX_PKG_CHARS);

  const userPrompt = `Files in repository root: ${safeFiles}\n\npackage.json content: ${safePkg}`;

  const raw = await callAI(systemPrompt, userPrompt, 150, true);
  if (!raw) return 'unknown';

  try {
    const parsed = JSON.parse(raw);
    const stack  = (parsed?.stack || '').trim().toLowerCase();
    return VALID_STACKS.has(stack) ? stack : 'unknown';
  } catch (err) {
    console.error('[AI Stack Detection] JSON parse failed:', err.message, '| Raw:', raw);
    return 'unknown';
  }
};

// ─── Feature 3: Deployment Health Predictor ───────────────────────────────────
/**
 * Predicts whether a deployment will succeed BEFORE running docker run.
 * Checks for known failure patterns: missing env vars, wrong ports, crash patterns.
 * Returns { willFail: bool, reason: string, suggestion: string }
 */
const predictDeploymentHealth = async (dockerfile, envVarKeys = [], stack = 'unknown') => {
  const systemPrompt = `You are a deployment pre-flight checker for a container hosting platform called LaunchPad.
Analyze the Dockerfile and available environment variable keys to predict if the deployment will fail.

Respond ONLY with valid JSON:
{
  "willFail": true | false,
  "confidence": <0-100>,
  "reason": "Why it will or won't fail.",
  "suggestion": "What to fix before deploying, or 'None' if everything looks good."
}

Common failure patterns to check:
- MONGODB_URI / DATABASE_URL missing for Node/MERN apps that use mongoose/pg/prisma
- JWT_SECRET missing for apps using jsonwebtoken
- EXPOSE port mismatch with app's listening port
- Missing npm install or build steps
- Large node_modules being COPY'd instead of installed`;

  const safeDockerfile = (dockerfile || '').slice(0, 2000);
  const userPrompt = `Stack: ${stack}
Available env var keys: ${envVarKeys.join(', ') || 'none'}

Dockerfile:
${safeDockerfile}`;

  const raw = await callAI(systemPrompt, userPrompt, 300, true);
  if (!raw) return { willFail: false, confidence: 0, reason: 'Health check unavailable.', suggestion: 'None' };

  try {
    const parsed = JSON.parse(raw);
    return {
      willFail:   !!parsed.willFail,
      confidence: parsed.confidence || 0,
      reason:     parsed.reason     || 'Unknown',
      suggestion: parsed.suggestion || 'None',
    };
  } catch {
    return { willFail: false, confidence: 0, reason: 'Parse error.', suggestion: 'None' };
  }
};

// ─── Feature 4: Build Log Summarizer ──────────────────────────────────────────
/**
 * Generates a short human-readable summary of a successful or failed build.
 * Used to populate the "Build Summary" card in the dashboard.
 */
const summarizeBuild = async (logs, stack, success = true) => {
  const systemPrompt = `You are a deployment assistant for LaunchPad, a hosting platform.
Write a 1-2 sentence plain-English summary of this ${success ? 'successful' : 'failed'} build.
Be specific about what was built, which framework, and any notable steps.
Do NOT use markdown. Be concise and professional.`;

  const safeLogs = compressLogs(logs, 2000);
  const userPrompt = `Stack: ${stack}\nStatus: ${success ? 'SUCCESS' : 'FAILURE'}\n\nLogs:\n${safeLogs}`;

  const response = await callAI(systemPrompt, userPrompt, 150, false);
  return response?.trim() || (success ? 'Build completed successfully.' : 'Build failed. Review logs for details.');
};

// ─── Feature 5: AI Config & Performance Optimizer ─────────────────────────────
/**
 * Reviews a project's files, package.json, and Dockerfile to suggest modern production optimizations.
 * Returns a JSON object with: { score, recommendations[], optimizedDockerfile }
 */
const generateOptimizationAdvice = async (fileList = [], packageJsonContent = '', dockerfile = '', stack = 'unknown') => {
  const systemPrompt = `You are an elite DevOps Architect.
Analyze the user's project files, dependencies, and Dockerfile to identify performance, security, and size optimizations.

Respond ONLY with a valid JSON object using this exact schema:
{
  "score": <0-100 score of current deployment quality>,
  "recommendations": [
    {
      "type": "Performance" | "Security" | "Size",
      "issue": "Brief description of the bottleneck or vulnerability.",
      "fix": "Actionable solution."
    }
  ],
  "optimizedDockerfile": "Complete, production-ready, highly-optimized Dockerfile using multi-stage builds, clean Nginx/Node configurations, and best practices. If no optimization is needed, output the original Dockerfile."
}

Ensure the "optimizedDockerfile" is fully escaped as a single-line JSON string or standard JSON format. Do not add markdown or extra text.`;

  const safeFiles = Array.isArray(fileList) ? fileList.slice(0, 100).join(', ') : '';
  const safePkg   = typeof packageJsonContent === 'object'
    ? JSON.stringify(packageJsonContent).slice(0, CONFIG.MAX_PKG_CHARS)
    : String(packageJsonContent || '').slice(0, CONFIG.MAX_PKG_CHARS);
  const safeDocker = (dockerfile || '').slice(0, 1500);

  const userPrompt = `Stack: ${stack}
Files in root: ${safeFiles}
package.json: ${safePkg}
Current Dockerfile:
${safeDocker}`;

  const raw = await callAI(systemPrompt, userPrompt, 1000, true);
  if (!raw) return {
    score: 50,
    recommendations: [{ type: "General", issue: "AI Service Offline", fix: "Could not optimize config at this time." }],
    optimizedDockerfile: dockerfile
  };

  try {
    const parsed = JSON.parse(raw);
    return {
      score: parsed.score || 70,
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      optimizedDockerfile: parsed.optimizedDockerfile || dockerfile
    };
  } catch (err) {
    console.error('[AI Optimization] JSON parse failed:', err.message);
    return {
      score: 60,
      recommendations: [{ type: "General", issue: "Failed to parse advice", fix: "Please try again later." }],
      optimizedDockerfile: dockerfile
    };
  }
};

// ─── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  callAI,
  analyzeError,
  detectStackWithAI,
  predictDeploymentHealth,
  summarizeBuild,
  generateOptimizationAdvice,
};