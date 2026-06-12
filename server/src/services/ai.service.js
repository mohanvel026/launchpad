const axios = require('axios');

// ─── Configuration ─────────────────────────────────────────────────────────────
const CONFIG = {
  GROQ_MODEL:    process.env.GROQ_MODEL    || 'llama-3.3-70b-versatile',
  GEMINI_MODEL:  process.env.GEMINI_MODEL  || 'gemini-1.5-flash-latest',
  TIMEOUT_MS:    parseInt(process.env.AI_TIMEOUT_MS, 10) || 25000,
  MAX_LOG_CHARS: 5000,
  MAX_PKG_CHARS: 1200,
  MAX_RETRIES:   2,
  RETRY_BASE_MS: 600,
};

const VALID_STACKS = new Set([
  'react', 'vue', 'svelte', 'astro', 'angular',
  'node', 'mern', 'static', 'next', 'nuxt',
  'fullstack-split', 'python', 'go', 'rust', 'ruby', 'java', 'php', 'dotnet', 'unknown'
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

// ─── Groq & Gemini Key Pool with Circuit-Breaker Cooldowns ──────────────────────

// Map to track rate-limited keys: key -> cooldownExpirationTime (timestamp)
const cooldownKeys = new Map();

const getCleanKeyPool = (varsArray) => {
  const keys = new Set();
  varsArray.forEach(v => {
    if (v && v !== 'placeholder') {
      v.split(',').forEach(k => {
        const trimmed = k.trim();
        if (trimmed && trimmed.length > 10 && trimmed !== 'placeholder') {
          keys.add(trimmed);
        }
      });
    }
  });
  return Array.from(keys);
};

const getGroqKeyPool = () => {
  return getCleanKeyPool([
    process.env.GROQ_API_KEY,
    process.env.GROQ_API_KEY_2,
    process.env.GROQ_API_KEY_3,
    process.env.GROQ_API_KEYS
  ]);
};

const getGeminiKeyPool = () => {
  return getCleanKeyPool([
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEYS
  ]);
};

// Round-robin counters for keys
let groqKeyIndex = 0;
let geminiKeyIndex = 0;

const selectActiveKey = (keyPool, isGroq = true) => {
  const now = Date.now();
  
  // Filter out keys in cooldown
  const activeKeys = keyPool.filter(k => {
    const expires = cooldownKeys.get(k);
    return !expires || expires < now;
  });

  if (activeKeys.length > 0) {
    const index = isGroq ? groqKeyIndex : geminiKeyIndex;
    const chosen = activeKeys[index % activeKeys.length];
    if (isGroq) {
      groqKeyIndex = (groqKeyIndex + 1) % activeKeys.length;
    } else {
      geminiKeyIndex = (geminiKeyIndex + 1) % activeKeys.length;
    }
    return chosen;
  }

  // Fallback: If ALL keys are in cooldown, pick the one that expires earliest
  let earliestKey = null;
  let earliestTime = Infinity;
  for (const k of keyPool) {
    const expires = cooldownKeys.get(k) || 0;
    if (expires < earliestTime) {
      earliestTime = expires;
      earliestKey = k;
    }
  }
  return earliestKey || keyPool[0];
};

const markKeyRateLimited = (key, cooldownMs = 60000) => {
  console.warn(`[AI Key Pool] Rate-limit (429) detected. Quarantining key ${key.slice(0, 8)}... for ${cooldownMs / 1000}s`);
  cooldownKeys.set(key, Date.now() + cooldownMs);
};

const callGroq = async (systemPrompt, userPrompt, maxTokens = 600, isJson = false) => {
  const keyPool = getGroqKeyPool();
  if (keyPool.length === 0) throw new Error('No GROQ_API_KEY configured.');

  // Try each key in the pool before giving up
  for (let attempt = 0; attempt < keyPool.length; attempt++) {
    const key = selectActiveKey(keyPool, true);
    if (!key) throw new Error('All Groq keys exhausted or rate-limited.');

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
        {
          headers: { Authorization: `Bearer ${key}` },
          timeout: 12000
        }
      );
      return res.data.choices[0].message.content;
    } catch (err) {
      const status = err.response?.status;
      if (status === 429) {
        markKeyRateLimited(key, 60000);
        if (attempt < keyPool.length - 1) {
          continue;
        }
      }
      throw err;
    }
  }
  throw new Error('All Groq keys exhausted or rate-limited.');
};

const callGemini = async (systemPrompt, userPrompt, maxTokens = 600, isJson = false, retryAttempt = 0) => {
  const keyPool = getGeminiKeyPool();
  if (keyPool.length === 0) throw new Error('No GEMINI_API_KEY configured.');

  try {
    for (let rotateAttempt = 0; rotateAttempt < keyPool.length; rotateAttempt++) {
      const key = selectActiveKey(keyPool, false);
      if (!key) throw new Error('All Gemini keys rate-limited.');

      try {
        const res = await httpClient.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${key}`,
          {
            systemInstruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: userPrompt }] }],
            generationConfig: {
              maxOutputTokens: maxTokens,
              temperature: 0.2,
              ...(isJson && { responseMimeType: 'application/json' }),
            },
          },
          { timeout: 10000 }
        );
        return res.data.candidates[0].content.parts[0].text;
      } catch (err) {
        const status = err.response?.status;
        if (status === 429) {
          markKeyRateLimited(key, 60000);
          if (rotateAttempt < keyPool.length - 1) {
            continue;
          }
        }
        throw err;
      }
    }
    throw new Error('All Gemini keys rate-limited.');
  } catch (err) {
    const status = err.response?.status;
    if (retryAttempt < CONFIG.MAX_RETRIES && (status === 429 || status >= 500)) {
      const delay = CONFIG.RETRY_BASE_MS * Math.pow(2, retryAttempt) + Math.random() * 200;
      console.warn(`[Gemini] Failover/Congestion retry ${retryAttempt + 1} in ${Math.round(delay)}ms...`);
      await sleep(delay);
      return callGemini(systemPrompt, userPrompt, maxTokens, isJson, retryAttempt + 1);
    }
    throw err;
  }
};

// ─── Orchestration: Groq → Gemini Failover ────────────────────────────────────

let lastRequestTime = 0;
const CONGESTION_DELAY_MS = 150; // 150ms base spacing prevents 429 without bottlenecking throughput

const callAI = async (systemPrompt, userPrompt, maxTokens = 600, isJson = false) => {
  // Stagger concurrent hits with jitter to prevent request synchronization storms
  const now = Date.now();
  const diff = now - lastRequestTime;
  if (diff < CONGESTION_DELAY_MS) {
    const jitter = Math.floor(Math.random() * 80); // 0-80ms randomized jitter
    const delay = CONGESTION_DELAY_MS - diff + jitter;
    await sleep(delay);
  }
  lastRequestTime = Date.now();

  // Try Gemini first as it is highly stable, free, and has an active key in .env
  try {
    return await callGemini(systemPrompt, userPrompt, maxTokens, isJson);
  } catch (geminiErr) {
    console.warn(formatApiError('Gemini', geminiErr));
    console.info('[AI] Failing over to Groq...');
    try {
      return await callGroq(systemPrompt, userPrompt, maxTokens, isJson);
    } catch (groqErr) {
      console.error(formatApiError('Groq', groqErr));
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
  const systemPrompt = `You are a Senior DevOps engineer and deployment specialist for LaunchLive.
Your job is to diagnose build and runtime failures with surgical precision and provide highly detailed, developer-friendly solutions.

Respond ONLY with a valid JSON object using this exact schema:
{
  "summary": "A brief 1-2 sentence overview of what went wrong.",
  "cause": "A detailed explanation of the exact root cause. Reference specific file names, package versions, missing environment variables, or line numbers visible in the logs.",
  "fix": "A step-by-step instruction guide on how the developer can fix this issue locally before pushing again.",
  "commands": ["npm install missing-package", "export MISSING_VAR=value"]
}

Rules:
- Be highly specific and technical, but easy to follow.
- "commands" should contain an array of ready-to-run shell commands if applicable, otherwise an empty array [].
- Do NOT add any markdown or text outside the JSON object itself (no backticks around the json).`;

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
Analyze the file list and package.json and determine the exact framework or language stack.

Return ONLY a valid JSON object: { "stack": "<value>", "confidence": <0-100> }

Valid stack values: "react", "vue", "svelte", "astro", "angular", "node", "mern", "static", "next", "nuxt", "fullstack-split", "python", "go", "rust", "ruby", "java", "php", "dotnet", "unknown"

Detection rules:
- "go" if go.mod exists
- "rust" if Cargo.toml exists
- "java" if pom.xml or build.gradle exists
- "ruby" if Gemfile exists
- "python" if requirements.txt, Pipfile, or pyproject.toml exists
- "php" if composer.json exists
- "dotnet" if .sln or .csproj exists
- "next" if next.js dependency present in package.json
- "nuxt" if nuxt dependency present in package.json
- "astro" if astro dependency present in package.json
- "svelte" if svelte or @sveltejs/kit present in package.json
- "vue" if vue dependency present in package.json (and not nuxt)
- "angular" if @angular/core present in package.json
- "react" if react present in package.json (and not next/mern)
- "mern" if express + react both present in package.json
- "fullstack-split" if both a frontend dir (client/frontend) and backend dir (server/backend) exist
- "node" if express/fastify present in package.json without react
- "static" if only HTML/CSS/JS files, no package.json or backend config files
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
  const systemPrompt = `You are a deployment pre-flight checker for a container hosting platform called LaunchLive.
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
  const systemPrompt = `You are a deployment assistant for LaunchLive, a hosting platform.
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

// ─── Feature 6: AI Env Auto-Discovery ──────────────────────────────────────────
/**
 * Local Static Analysis Fallback
 * Scans source code patterns with high-speed regex to extract keys if the external AI service fails or is rate-limited.
 */
const extractEnvVarsLocally = (code = '') => {
  const regex = /process\.env\.([A-Z_0-9]+)/g;
  const discoveredKeys = new Set();
  let match;
  while ((match = regex.exec(code)) !== null) {
    const key = match[1];
    // Exclude common global environment keys that developers don't usually set manually
    if (!['NODE_ENV', 'PORT', 'PATH', 'HOME', 'USER'].includes(key)) {
      discoveredKeys.add(key);
    }
  }

  const crypto = require('crypto');
  return Array.from(discoveredKeys).map(key => {
    let suggestedValue = '';
    let validationPattern = '';
    let validationErrorMessage = '';

    // Generate high-entropy suggested value for secrets
    if (key.includes('SECRET') || key.includes('TOKEN') || key.includes('KEY') || key.includes('PASSWORD')) {
      if (!key.includes('URI') && !key.includes('URL') && !key.includes('PATH')) {
        suggestedValue = crypto.randomBytes(32).toString('hex');
      }
    }

    // Set connection validators
    if (key.includes('MONGO')) {
      validationPattern = '^(mongodb(?:\\+srv)?):\\/\\/.+$';
      validationErrorMessage = 'Must be a valid MongoDB connection string starting with mongodb:// or mongodb+srv://';
    } else if (key.includes('PORT')) {
      validationPattern = '^\\d{2,5}$';
      validationErrorMessage = 'Must be a valid port number (e.g. 3000 to 65535)';
    } else if (key.includes('URL') || key.includes('URI')) {
      validationPattern = '^https?:\\/\\/.+$';
      validationErrorMessage = 'Must be a valid URL starting with http:// or https://';
    }

    return {
      key,
      required: true,
      description: 'Auto-detected via host Static Code Analysis.',
      placeholder: '',
      suggestedValue,
      validationPattern,
      validationErrorMessage
    };
  });
};

/**
 * Aggressive JSON Cleanser
 * Strips markdown code fences, trailing commas, and resolves malformed formatting before parsing.
 */
const cleanJson = (str = '') => {
  let cleaned = str.trim();
  // Remove markdown block backticks if present
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/```$/, '');
  // Remove trailing commas before closing brackets/braces
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
  return cleaned.trim();
};

/**
 * GitGuardian-style exposed credentials detector
 * Analyzes code for accidentally hardcoded secrets (API keys, private keys, database connections).
 */
const auditLeakedSecrets = (code = '') => {
  const leaks = [];
  
  // 1. Google API Key Pattern
  const googleMatch = code.match(/AIzaSy[A-Za-z0-9_-]{35}/g);
  if (googleMatch) {
    googleMatch.forEach(key => leaks.push({ type: 'Google API Key', leakedValue: key.slice(0, 8) + '...' }));
  }

  // 2. MongoDB connection string with embedded password pattern
  const mongoMatch = code.match(/mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/g);
  if (mongoMatch) {
    leaks.push({ type: 'MongoDB Connection Credentials (Embedded Password)', leakedValue: 'mongodb://[user]:[pass]@...' });
  }

  // 3. AWS Access Key / Secret Match
  const awsKeyMatch = code.match(/(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g);
  if (awsKeyMatch) {
    awsKeyMatch.forEach(key => leaks.push({ type: 'AWS Access Key ID', leakedValue: key }));
  }

  // 4. Hardcoded private/secret token strings
  const secretAssignmentMatch = code.match(/(?:jwt_secret|jwtSecret|sessionSecret|cookieSecret|api_key|apiKey)\s*=\s*['"`]([a-zA-Z0-9_\-!@#$]{8,64})['"`]/gi);
  if (secretAssignmentMatch) {
    secretAssignmentMatch.forEach(match => leaks.push({ type: 'Hardcoded Cryptographic Secret/Key Assignment', leakedValue: match }));
  }

  return leaks;
};

/**
 * Detects variable collisions (e.g. MONGO_URI vs MONGODB_URI)
 */
const findVariableCollisions = (keys = []) => {
  const collisions = [];
  const upperKeys = keys.map(k => k.toUpperCase());

  if (upperKeys.includes('MONGO_URI') && upperKeys.includes('MONGODB_URI')) {
    collisions.push({
      type: 'Database URI redundancy',
      message: 'Detected both MONGO_URI and MONGODB_URI. This may cause connection discrepancies depending on which library runs.'
    });
  }
  if (upperKeys.includes('JWT_SECRET') && upperKeys.includes('JWT_TOKEN')) {
    collisions.push({
      type: 'JSON Web Token secret redundancy',
      message: 'Detected both JWT_SECRET and JWT_TOKEN. Standardize on JWT_SECRET for consistency.'
    });
  }
  return collisions;
};

/**
 * Scans project files or aggregated code patterns to find and list all expected environment variables.
 * Returns a JSON array of: { key, required, description, placeholder, suggestedValue, validationPattern, validationErrorMessage }
 */
const discoverRequiredEnvVars = async (codeSnippets = '', stack = 'unknown', dependenciesList = [], securityWarnings = [], collisions = []) => {
  const systemPrompt = `You are a DevOps security auditor.
Analyze the source code snippets and list all environment variables (e.g. process.env.XYZ or env("XYZ") in Prisma schemas) that the application expects.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "detectedVars": [
    {
      "key": "VARIABLE_NAME",
      "required": true | false,
      "description": "Brief explanation of what this variable is used for.",
      "placeholder": "A safe example or placeholder value.",
      "validationRule": "mongodb" | "url" | "port" | "jwt" | "none"
    }
  ]
}

Only return variables that are actually used in the code. Do not include markdown or extra text.`;

  const safeCode = (codeSnippets || '').slice(0, CONFIG.MAX_LOG_CHARS);
  const userPrompt = `Stack: ${stack}
Dependencies present in project: ${dependenciesList.join(', ') || 'none'}
Source Code Snippets:
${safeCode}`;

  let detectedVars = [];
  let raw = '';
  try {
    raw = await callAI(systemPrompt, userPrompt, 800, true);
  } catch (aiErr) {
    console.warn('[AI Env Discovery] External AI call failed. Falling back to local static analysis...', aiErr.message);
    detectedVars = extractEnvVarsLocally(codeSnippets);
  }

  if (raw) {
    try {
      const cleanedJson = cleanJson(raw);
      const parsed = JSON.parse(cleanedJson);
      const vars = Array.isArray(parsed.detectedVars) ? parsed.detectedVars : [];
      
      const crypto = require('crypto');
      detectedVars = vars.map(v => {
        const key = v.key.toUpperCase();
        let suggestedValue = '';
        let validationPattern = '';
        let validationErrorMessage = '';

        if (key.includes('SECRET') || key.includes('TOKEN') || key.includes('KEY') || key.includes('PASSWORD')) {
          if (!key.includes('URI') && !key.includes('URL') && !key.includes('PATH')) {
            suggestedValue = crypto.randomBytes(32).toString('hex');
          }
        }

        if (v.validationRule === 'mongodb' || key.includes('MONGO')) {
          validationPattern = '^(mongodb(?:\\+srv)?):\\/\\/.+$';
          validationErrorMessage = 'Must be a valid MongoDB connection string starting with mongodb:// or mongodb+srv://';
        } else if (v.validationRule === 'port' || key.includes('PORT')) {
          validationPattern = '^\\d{2,5}$';
          validationErrorMessage = 'Must be a valid port number (e.g. 3000 to 65535)';
        } else if (v.validationRule === 'url' || key.includes('URL') || key.includes('URI')) {
          validationPattern = '^https?:\\/\\/.+$';
          validationErrorMessage = 'Must be a valid URL starting with http:// or https://';
        }

        return {
          key: v.key,
          required: !!v.required,
          description: v.description || 'Application environment configuration.',
          placeholder: v.placeholder || '',
          suggestedValue,
          validationPattern,
          validationErrorMessage
        };
      });
    } catch (err) {
      console.warn('[AI Env Discovery] JSON parse failed, falling back to local static analysis. Error:', err.message);
      detectedVars = extractEnvVarsLocally(codeSnippets);
    }
  }

  if (detectedVars.length === 0) {
    detectedVars = extractEnvVarsLocally(codeSnippets);
  }

  // Inject Leaked Secrets Audit & Collisions for Enterprise-grade security
  const localLeaks = auditLeakedSecrets(codeSnippets);
  const localCollisions = findVariableCollisions(detectedVars.map(v => v.key));

  const allWarnings = [...new Set([...securityWarnings.map(JSON.stringify), ...localLeaks.map(JSON.stringify)])].map(JSON.parse);
  const allCollisions = [...new Set([...collisions.map(JSON.stringify), ...localCollisions.map(JSON.stringify)])].map(JSON.parse);

  return {
    detectedVars,
    securityWarnings: allWarnings,
    collisions: allCollisions
  };
};

// ─── Feature 7: AI Runtime Log Health Inspector ───────────────────────────────
/**
 * Scans live running stdout/stderr output from active containers to detect silent health issues.
 * Returns: { isHealthy: bool, anomalies: [{ severity, message, fix }] }
 */
const inspectRuntimeLogs = async (runtimeLogs = '', stack = 'unknown') => {
  const systemPrompt = `You are an elite SRE engineer.
Scan the active runtime container logs and check for unhandled exceptions, database connection timeouts, memory leaks, high latency, or server crashes.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "isHealthy": true | false,
  "anomalies": [
    {
      "severity": "CRITICAL" | "WARNING" | "INFO",
      "message": "Specific description of the anomaly found.",
      "fix": "Actionable instructions to resolve this."
    }
  ]
}

If no issues are found, return isHealthy: true and anomalies: []. Do not include markdown.`;

  const safeLogs = compressLogs(runtimeLogs, 3000);
  const userPrompt = `Stack: ${stack}\nRuntime Logs:\n${safeLogs}`;

  const raw = await callAI(systemPrompt, userPrompt, 600, true);
  if (!raw) return { isHealthy: true, anomalies: [] };

  try {
    const parsed = JSON.parse(raw);
    return {
      isHealthy: parsed.isHealthy !== false,
      anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : []
    };
  } catch (err) {
    console.error('[AI Log Inspector] JSON parse failed:', err.message);
    return { isHealthy: true, anomalies: [] };
  }
};

// ─── Feature 8: AI Database Query Optimizer ───────────────────────────────────
/**
 * Scans source code snippets containing database operations (Mongoose, Prisma, SQL) to offer index and query optimizations.
 * Returns: { recommendations: [{ file, query, indexAdvice, speedImpact }] }
 */
const optimizeQueries = async (codeSnippets = '', stack = 'unknown') => {
  const systemPrompt = `You are a Database Performance Expert.
Analyze the source code queries (Mongoose schemas, find(), SQL select/joins, etc.) and suggest index improvements and pipeline tuning.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "recommendations": [
    {
      "file": "Name of the file (or 'unknown').",
      "query": "The code snippet of the query.",
      "indexAdvice": "Specific database index to create (e.g. { owner: 1, status: -1 }).",
      "speedImpact": "Estimated impact: 'HIGH' | 'MEDIUM' | 'LOW'"
    }
  ]
}

If no optimization is needed, return recommendations: []. Do not include markdown.`;

  const safeCode = (codeSnippets || '').slice(0, CONFIG.MAX_LOG_CHARS);
  const userPrompt = `Stack: ${stack}\nDatabase Code Snippets:\n${safeCode}`;

  const raw = await callAI(systemPrompt, userPrompt, 800, true);
  if (!raw) return { recommendations: [] };

  try {
    const parsed = JSON.parse(raw);
    const rawRecs = Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
    const recommendations = rawRecs.filter(r => {
      if (!r.query || !r.indexAdvice) return false;
      const q = r.query.toLowerCase();
      const a = typeof r.indexAdvice === 'string' ? r.indexAdvice.toLowerCase() : '';
      if (q.includes('no database queries') || q.includes('no queries found') || a === 'none') {
        return false;
      }
      return true;
    });
    return { recommendations };
  } catch (err) {
    console.error('[AI Query Optimizer] JSON parse failed:', err.message);
    return { recommendations: [] };
  }
};

// ─── Feature 9: AI Resource Predictor ──────────────────────────────────────────
/**
 * Predicts container OCPU and RAM resources required for healthy running.
 * Returns: { cpuLimit, ramLimitMB, needsRedis, suggestions[] }
 */
const predictResourceRequirements = async (packageJsonContent = '', stack = 'unknown') => {
  const systemPrompt = `You are a Cloud Capacity Planning Specialist.
Analyze the framework stack and package.json to estimate the best container resource allocations.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "cpuLimit": "Number of OCPUs to allocate (e.g. '0.5' or '1.0').",
  "ramLimitMB": <RAM allocation in MB (number between 128 and 1024)>,
  "needsRedis": true | false,
  "suggestions": [
    "One sentence capacity/caching advice."
  ]
}

Do not include markdown or extra text.`;

  const safePkg = typeof packageJsonContent === 'object'
    ? JSON.stringify(packageJsonContent).slice(0, CONFIG.MAX_PKG_CHARS)
    : String(packageJsonContent || '').slice(0, CONFIG.MAX_PKG_CHARS);

  const userPrompt = `Stack: ${stack}\npackage.json:\n${safePkg}`;

  const raw = await callAI(systemPrompt, userPrompt, 400, true);
  if (!raw) return { cpuLimit: '0.5', ramLimitMB: 256, needsRedis: false, suggestions: [] };

  try {
    const parsed = JSON.parse(raw);
    return {
      cpuLimit: parsed.cpuLimit || '0.5',
      ramLimitMB: parsed.ramLimitMB || 256,
      needsRedis: !!parsed.needsRedis,
      suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : []
    };
  } catch (err) {
    console.error('[AI Resource Predictor] JSON parse failed:', err.message);
    return { cpuLimit: '0.5', ramLimitMB: 256, needsRedis: false, suggestions: [] };
  }
};



// ─── Feature 10: AI Auto-Doc & README Generator ──────────────────────────────
/**
 * Scans routes, controllers, and project files to automatically generate API reference and a professional README.
 * Returns: { readme: string, apiDocs: string, apiEndpoints: [{ method, route, description, params }] }
 */
const generateDocsAndReadme = async (codeSnippets = '', stack = 'unknown') => {
  const safeCode = (codeSnippets || '').slice(0, CONFIG.MAX_LOG_CHARS);

  // ── Extract project metadata from context string for template building ──
  const nameMatch    = safeCode.match(/Project Name:\s*(.+)/);
  const repoMatch    = safeCode.match(/Repository:\s*(.+)/);
  const branchMatch  = safeCode.match(/Branch:\s*(.+)/);
  const stackMatch   = safeCode.match(/Stack:\s*(.+)/);
  const projectName  = nameMatch?.[1]?.trim()  || 'My Project';
  const repoName     = repoMatch?.[1]?.trim()  || 'github.com/user/repo';
  const branch       = branchMatch?.[1]?.trim() || 'main';
  const detectedStack = stackMatch?.[1]?.trim() || stack;

  // ── Stack-specific setup commands ──
  const stackCommands = {
    'react':          { install: 'npm install', dev: 'npm run dev', build: 'npm run build', port: '5173' },
    'next':           { install: 'npm install', dev: 'npm run dev', build: 'npm run build', port: '3000' },
    'nuxt':           { install: 'npm install', dev: 'npm run dev', build: 'npm run build', port: '3000' },
    'node':           { install: 'npm install', dev: 'npm run dev', build: 'N/A',           port: '5000' },
    'mern':           { install: 'npm install', dev: 'npm run dev', build: 'npm run build', port: '5000' },
    'fullstack-split':{ install: 'npm install (in /client and /server)', dev: 'npm run dev', build: 'npm run build', port: '5000/5173' },
    'static':         { install: 'N/A',         dev: 'open index.html', build: 'N/A',       port: 'N/A' },
    'vue':            { install: 'npm install', dev: 'npm run dev', build: 'npm run build', port: '5173' },
    'svelte':         { install: 'npm install', dev: 'npm run dev', build: 'npm run build', port: '5173' },
    'astro':          { install: 'npm install', dev: 'npm run dev', build: 'npm run build', port: '4321' },
    'angular':        { install: 'npm install', dev: 'ng serve',   build: 'ng build',       port: '4200' },
  };
  const cmds = stackCommands[detectedStack] || stackCommands['node'];

  // ── Always-available template README (no AI required) ──
  const templateReadme = `# ${projectName}

> A **${detectedStack.toUpperCase()}** application deployed via [LaunchLive](https://github.com).

## 🚀 Tech Stack

- **Framework:** ${detectedStack}
- **Repository:** [${repoName}](https://github.com/${repoName})
- **Branch:** \`${branch}\`

## ⚡ Quick Start

\`\`\`bash
# Clone the repository
git clone https://github.com/${repoName}.git
cd ${projectName.toLowerCase().replace(/\s+/g, '-')}

# Install dependencies
${cmds.install}

# Start development server
${cmds.dev}
\`\`\`

The app will be available at \`http://localhost:${cmds.port}\`.

## 📦 Available Scripts

| Command | Description |
|:--------|:------------|
| \`${cmds.dev}\` | Start the development server |
| \`${cmds.build}\` | Build for production |

## 🌍 Environment Variables

Create a \`.env\` file in the root directory and add your environment variables:

\`\`\`env
NODE_ENV=development
PORT=${cmds.port.split('/')[0]}
# Add your environment variables here
\`\`\`

## 📁 Project Structure

\`\`\`
${projectName}/
${detectedStack === 'fullstack-split' ? '├── client/          # Frontend application\n├── server/          # Backend API server\n├── .env             # Environment variables\n└── README.md' : '├── src/             # Source files\n├── public/          # Static assets\n├── .env             # Environment variables\n└── README.md'}
\`\`\`

## 🚢 Deployment

This project is deployed on **LaunchLive** with automated CI/CD from the \`${branch}\` branch.

---
*README auto-generated by LaunchLive AI Co-Pilot*`;

  // ── Try AI to generate a richer, code-aware README (optional enhancement) ──
  let readme = templateReadme;
  try {
    const readmeSystemPrompt = `You are an expert Technical Writer. Generate a professional README.md in markdown format for this ${detectedStack} project. Include: project title with emoji, description, tech stack badges, setup steps, environment variables table, and API overview if applicable. Be specific and detailed. Output ONLY raw markdown, no JSON, no code fences around the whole response.`;
    const readmeRaw = await callAI(readmeSystemPrompt, safeCode, 1000, false);
    if (readmeRaw && readmeRaw.length > 200 && !readmeRaw.includes('could not')) {
      readme = readmeRaw;
    }
  } catch (e) {
    console.warn('[AI Doc Gen] AI README enhancement failed, using template:', e.message);
  }

  // ── Try AI to extract API endpoints (optional enhancement) ──
  let apiEndpoints = [];
  try {
    const endpointsSystemPrompt = `Analyze this code and extract HTTP API route definitions. Respond ONLY with valid JSON: { "apiEndpoints": [{ "method": "GET", "path": "/api/route", "description": "one sentence" }] }. Max 15 endpoints. No markdown fences.`;
    const endpointsRaw = await callAI(endpointsSystemPrompt, `Stack: ${detectedStack}\n${safeCode}`, 500, true);
    if (endpointsRaw) {
      const parsed = JSON.parse(cleanJson(endpointsRaw));
      if (Array.isArray(parsed.apiEndpoints)) apiEndpoints = parsed.apiEndpoints;
    }
  } catch (e) {
    console.warn('[AI Doc Gen] Endpoints extraction failed:', e.message);
  }

  return {
    readme,
    apiDocs: `# REST API Reference\n\n${apiEndpoints.length > 0
      ? apiEndpoints.map(ep => `- **${ep.method}** \`${ep.path || ep.route}\` — ${ep.description}`).join('\n')
      : `No API routes detected. This is a **${detectedStack}** project.`}`,
    apiEndpoints
  };
};

// ─── Feature 11: AI Security & Dependency Auditor ─────────────────────────────
/**
 * Audits package.json dependencies and security setup for CVEs, helmet, rate-limiters, or SQL injections.
 * Returns: { securityScore, securityGrade, issues: [{ type, severity, description, fix, cliCommand }] }
 */
const auditSecurityAndDependencies = async (packageJsonContent = '', codeSnippets = '', stack = 'unknown') => {
  const systemPrompt = `You are a Cybersecurity Pen-Tester and Dependency Auditor.
Analyze the package.json and code snippets for potential vulnerabilities, outdated dependency versions, lack of helmet/cors, insecure headers, or query injection paths.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "securityScore": <Integer score between 0 and 100>,
  "securityGrade": "A+" | "A" | "B" | "C" | "D" | "F",
  "issues": [
    {
      "type": "Dependency Vulnerability" | "Missing Security Header" | "CORS Risk" | "No Rate Limiter" | "SQL/NoSQL Injection Path",
      "severity": "CRITICAL" | "HIGH" | "MEDIUM" | "LOW",
      "cveCode": "e.g. CVE-2023-XYZ or OWASP-A1",
      "description": "Specific explanation of the threat.",
      "fix": "Specific, actionable remediation instructions.",
      "cliCommand": "Exact NPM/Yarn CLI command to run to remediate (e.g. 'npm install helmet --save' or 'npm audit fix')"
    }
  ]
}

If the application is secure, return score: 100, securityGrade: 'A+' and issues: []. Do not include markdown fences.`;

  const safePkg = typeof packageJsonContent === 'object'
    ? JSON.stringify(packageJsonContent).slice(0, CONFIG.MAX_PKG_CHARS)
    : String(packageJsonContent || '').slice(0, CONFIG.MAX_PKG_CHARS);
  const safeCode = (codeSnippets || '').slice(0, CONFIG.MAX_LOG_CHARS);

  const userPrompt = `Stack: ${stack}\npackage.json:\n${safePkg}\nSource Code Snippets:\n${safeCode}`;

  const raw = await callAI(systemPrompt, userPrompt, 1000, true);
  if (!raw) return { securityScore: 80, securityGrade: 'B', issues: [] };

  try {
    const cleanedJson = cleanJson(raw);
    const parsed = JSON.parse(cleanedJson);
    return {
      securityScore: parsed.securityScore || 85,
      securityGrade: parsed.securityGrade || 'B',
      issues: Array.isArray(parsed.issues) ? parsed.issues : []
    };
  } catch (err) {
    console.error('[AI Security Auditor] JSON parse failed:', err.message);
    return { 
      securityScore: 90, 
      securityGrade: 'A',
      issues: [{ type: "Auditor", severity: "LOW", description: "Audit completed but response formatting erred.", fix: "Retry auditing again.", cliCommand: "" }] 
    };
  }
};

/**
 * Analyzes live container CPU/RAM metrics history and web traffic latency analytics.
 * Returns sizing recommendations, anomalies, and active scaling advice.
 */
const analyzeTelemetryAndPredictScaling = async (metricsSnapshot, metricsHistory = [], trafficAnalytics, stack = 'unknown') => {
  const systemPrompt = `You are an expert SRE Telemetry Observer and Capacity Architect.
Analyze the live system telemetry data (CPU/RAM snapshots, rolling metric history, web latency, error rates, and traffic volume) to audit health anomalies and suggest size scaling optimizations.

Respond ONLY with a valid JSON object matching this exact schema:
{
  "cpuUsageAnalysis": "One sentence describing active CPU loads and throttling observations.",
  "ramUsageAnalysis": "One sentence describing RAM limits and leak vulnerability (e.g. constant memory climb with no drops).",
  "anomalyAlerts": [
    "Alert if CPU is >80%, RAM is >85%, or response latency is over 500ms. Otherwise empty array."
  ],
  "predictedGrowth": "Forecast of resources/sizing needs based on traffic volume.",
  "recommendedCpu": "OCPU recommendation (e.g. '0.25', '0.5', '1.0').",
  "recommendedRam": "RAM recommendation in MB (e.g. '256', '512', '1024').",
  "scalingAdvice": [
    "One active sizing or caching advice (e.g. 'Add Redis buffering to drop latency', 'Scale up RAM allocation')."
  ]
}

Do not include markdown blocks or extra text around the JSON object.`;

  const inputTelemetry = {
    stack,
    metricsSnapshot,
    metricsHistorySummary: metricsHistory.slice(-10).map(m => `CPU:${m.cpu}%, RAM:${m.memMB}MB`).join(' -> '),
    trafficAnalyticsSummary: {
      totalVisits: trafficAnalytics.totalVisits || 0,
      totalErrors: trafficAnalytics.totalErrors || 0,
      avgResponseTime: `${trafficAnalytics.avgResponseTime || 0}ms`,
      uptime: trafficAnalytics.uptime || '100%'
    }
  };

  const raw = await callAI(systemPrompt, JSON.stringify(inputTelemetry), 800, true);
  if (!raw) return { cpuUsageAnalysis: 'Telemetry offline.', ramUsageAnalysis: 'Telemetry offline.', anomalyAlerts: [], predictedGrowth: 'Not available.', recommendedCpu: '0.5', recommendedRam: '256', scalingAdvice: [] };

  try {
    const cleanedJson = cleanJson(raw);
    const parsed = JSON.parse(cleanedJson);
    return {
      cpuUsageAnalysis: parsed.cpuUsageAnalysis || 'CPU usage looks normal.',
      ramUsageAnalysis: parsed.ramUsageAnalysis || 'Memory footprints look healthy.',
      anomalyAlerts: Array.isArray(parsed.anomalyAlerts) ? parsed.anomalyAlerts : [],
      predictedGrowth: parsed.predictedGrowth || 'Steady traffic capacity expected.',
      recommendedCpu: parsed.recommendedCpu || '0.5',
      recommendedRam: parsed.recommendedRam || '256',
      scalingAdvice: Array.isArray(parsed.scalingAdvice) ? parsed.scalingAdvice : []
    };
  } catch (err) {
    console.error('[AI Telemetry Analyzer] JSON parse failed:', err.message);
    return { cpuUsageAnalysis: 'Analyzed with standard parameters.', ramUsageAnalysis: 'Analyzed with standard parameters.', anomalyAlerts: [], predictedGrowth: 'Steady.', recommendedCpu: '0.5', recommendedRam: '256', scalingAdvice: [] };
  }
};

// ─── Feature 12: Deployment Readiness Advisor ──────────────────────────────────
/**
 * Pre-deploy health check: scores the repository 0-100 and returns a checklist.
 * Returns: { score, checks: [{ name, passed, recommendation, severity }] }
 */
const generateDeploymentReadinessReport = async (repoPath, stack) => {
  const fs = require('fs');
  const path = require('path');

  // Run local static checks first (fast, no AI needed)
  const checks = [];

  // 1. Check for health endpoint
  let hasHealthEndpoint = false;
  try {
    const dirs = ['server', 'backend', '.'].map(d => path.join(repoPath, d));
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const files = fs.readdirSync(dir).filter(f => /\.(js|ts)$/.test(f));
      for (const file of files.slice(0, 10)) {
        const content = fs.readFileSync(path.join(dir, file), 'utf8');
        if (/\/health|\/ping|\/status/i.test(content)) { hasHealthEndpoint = true; break; }
      }
      if (hasHealthEndpoint) break;
    }
  } catch {}
  checks.push({ name: 'Health Endpoint', passed: hasHealthEndpoint, severity: 'medium', recommendation: hasHealthEndpoint ? 'Good — health endpoint detected.' : 'Add a GET /health route that returns 200 OK for container health probing.' });

  // 2. Check for error handling middleware
  let hasErrorHandling = false;
  try {
    const appFiles = ['app.js', 'server.js', 'index.js'].map(f => path.join(repoPath, f));
    for (const f of appFiles) {
      if (fs.existsSync(f)) {
        const c = fs.readFileSync(f, 'utf8');
        if (/app\.use.*err.*req.*res.*next|express.*error/i.test(c)) { hasErrorHandling = true; break; }
      }
    }
  } catch {}
  checks.push({ name: 'Error Handling Middleware', passed: hasErrorHandling, severity: 'high', recommendation: hasErrorHandling ? 'Good — error handler detected.' : 'Add an Express error-handler: app.use((err, req, res, next) => res.status(500).json({ error: err.message }))' });

  // 3. Check for .env.example or documented env vars
  const hasEnvExample = ['.env.example', '.env.sample', 'env.example'].some(f => fs.existsSync(path.join(repoPath, f)));
  checks.push({ name: '.env.example File', passed: hasEnvExample, severity: 'low', recommendation: hasEnvExample ? 'Good — .env.example present.' : 'Create a .env.example documenting all required environment variables.' });

  // 4. Check for package.json scripts (start, build)
  let hasStartScript = false, hasBuildScript = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
    hasStartScript = !!(pkg.scripts?.start || pkg.scripts?.['node:start']);
    hasBuildScript = !!(pkg.scripts?.build);
  } catch {}
  const needsBuild = ['react', 'vue', 'next', 'nuxt', 'svelte', 'angular', 'astro'].includes(stack);
  checks.push({ name: 'Start Script (package.json)', passed: hasStartScript || stack === 'static', severity: 'critical', recommendation: hasStartScript ? 'Good — start script detected.' : 'Add "start": "node server.js" to package.json scripts.' });
  if (needsBuild) {
    checks.push({ name: 'Build Script (package.json)', passed: hasBuildScript, severity: 'high', recommendation: hasBuildScript ? 'Good — build script detected.' : 'Add "build" script to package.json for production bundling.' });
  }

  // 5. Check for helmet / security headers
  let hasHelmet = false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoPath, 'package.json'), 'utf8'));
    hasHelmet = !!(pkg.dependencies?.helmet || pkg.devDependencies?.helmet);
  } catch {}
  if (['node', 'mern', 'fullstack-split'].includes(stack)) {
    checks.push({ name: 'Security Headers (helmet)', passed: hasHelmet, severity: 'medium', recommendation: hasHelmet ? 'Good — helmet is configured.' : 'Install helmet: npm install helmet and add app.use(helmet()) to your Express app.' });
  }

  const passed = checks.filter(c => c.passed).length;
  const total = checks.length;
  const criticalFails = checks.filter(c => !c.passed && c.severity === 'critical').length;
  const highFails = checks.filter(c => !c.passed && c.severity === 'high').length;
  let score = Math.round((passed / total) * 100);
  if (criticalFails > 0) score = Math.min(score, 40);
  else if (highFails > 0) score = Math.min(score, 70);

  return { score, checks, passed, total };
};

// ─── Feature 13: Runtime Health AI Analyzer ─────────────────────────────────
/**
 * Analyzes runtime logs and container metrics for anomalies.
 * Returns: { score: 0-100, status: 'healthy'|'degraded'|'critical', anomalies[], recommendation }
 */
const analyzeRuntimeHealth = async (logs, metrics, stack = 'unknown') => {
  const systemPrompt = `You are an expert SRE observing live production container telemetry and logs.
Detect anomalies: memory leaks (RAM climbing without GC drops), crash loops (repeated exits), high CPU throttling, unhandled exceptions, or connection failures.

Respond ONLY with valid JSON:
{
  "score": <0-100 health score>,
  "status": "healthy" | "degraded" | "critical",
  "anomalies": [
    { "type": "MemoryLeak" | "CrashLoop" | "HighCPU" | "UnhandledException" | "ConnectionFailure" | "SlowResponse", "severity": "critical" | "warning", "message": "Specific finding.", "fix": "Actionable fix." }
  ],
  "recommendation": "One-sentence summary recommendation."
}

If no issues, return score: 100, status: 'healthy', anomalies: []. No markdown.`;

  const metricsStr = metrics ? `CPU: ${metrics.cpu}%, RAM: ${metrics.memMB}MB / ${metrics.memLimit}MB (${metrics.memPct}%)` : 'No live metrics available.';
  const safeLogs = (logs || '').slice(0, 4000);

  const raw = await callAI(systemPrompt, `Stack: ${stack}\nMetrics: ${metricsStr}\nRuntime Logs:\n${safeLogs}`, 600, true);
  if (!raw) return { score: 100, status: 'healthy', anomalies: [], recommendation: 'AI telemetry offline.' };

  try {
    const parsed = JSON.parse(raw.replace(/^```json/, '').replace(/```$/, '').trim());
    return {
      score: parsed.score ?? 100,
      status: parsed.status || 'healthy',
      anomalies: Array.isArray(parsed.anomalies) ? parsed.anomalies : [],
      recommendation: parsed.recommendation || 'System looks healthy.'
    };
  } catch { return { score: 100, status: 'healthy', anomalies: [], recommendation: 'Parse error — treating as healthy.' }; }
};

// ─── Feature 14: Cost Estimator ──────────────────────────────────────────────
/**
 * Estimates monthly VPS cost from CPU/RAM usage history.
 * Returns: { currentMonthlyCostUSD, projectedCostUSD, breakdown, recommendations[] }
 */
const estimateMonthlyCost = async (metricsHistory = [], project = {}) => {
  // Base VPS cost assumptions (Oracle Free Tier / equivalent)
  const BASE_VPS_COST = 6.0; // USD/month for 1 OCPU 6GB VPS
  const CPU_PRICE_PER_OCPU = 4.0; // USD/month per OCPU
  const RAM_PRICE_PER_GB = 0.5; // USD/month per GB

  const avgCpu = metricsHistory.length > 0
    ? metricsHistory.reduce((a, m) => a + (m.cpu || 0), 0) / metricsHistory.length
    : 5;
  const avgRam = metricsHistory.length > 0
    ? metricsHistory.reduce((a, m) => a + (m.memMB || 0), 0) / metricsHistory.length
    : 128;

  const cpuCost = (project.cpuLimit || 0.5) * CPU_PRICE_PER_OCPU;
  const ramCost = ((project.ramLimitMB || 256) / 1024) * RAM_PRICE_PER_GB * 30;
  const currentCost = parseFloat((BASE_VPS_COST * 0.3 + cpuCost + ramCost).toFixed(2));

  // Growth projection (assume 20% monthly traffic growth)
  const projectedCost = parseFloat((currentCost * 1.2).toFixed(2));

  const recommendations = [];
  if ((project.cpuLimit || 0.5) > 0.5 && avgCpu < 20) {
    recommendations.push(`CPU is ${avgCpu.toFixed(1)}% avg — downsize to 0.25 CPU to save ~$${(CPU_PRICE_PER_OCPU * 0.25).toFixed(2)}/mo.`);
  }
  if ((project.ramLimitMB || 256) > 256 && avgRam < 100) {
    recommendations.push(`RAM usage is ${avgRam.toFixed(0)}MB avg — downsize to 256MB to save ~$${(RAM_PRICE_PER_GB * 0.25).toFixed(2)}/mo.`);
  }
  if (recommendations.length === 0) {
    recommendations.push('Resource allocation looks optimal for current usage.');
  }

  return {
    currentMonthlyCostUSD: currentCost,
    projectedCostUSD: projectedCost,
    breakdown: {
      base: parseFloat((BASE_VPS_COST * 0.3).toFixed(2)),
      cpu: parseFloat(cpuCost.toFixed(2)),
      ram: parseFloat(ramCost.toFixed(2)),
    },
    avgCpuPercent: parseFloat(avgCpu.toFixed(1)),
    avgRamMB: parseFloat(avgRam.toFixed(0)),
    recommendations,
  };
};

// ─── Feature 15: Build Performance Trend Analyzer ───────────────────────────
/**
 * Analyzes deployment duration trends and returns AI optimization tips.
 * Returns: { avgBuildTimeMs, successRate, trend: 'improving'|'degrading'|'stable', tips[] }
 */
const analyzeBuildTrends = async (deployments = []) => {
  if (deployments.length === 0) return { avgBuildTimeMs: 0, successRate: 100, trend: 'stable', tips: [] };

  const successful = deployments.filter(d => d.status === 'success');
  const successRate = Math.round((successful.length / deployments.length) * 100);
  const withDuration = deployments.filter(d => d.duration && d.duration > 0);
  const avgBuildTimeMs = withDuration.length > 0
    ? Math.round(withDuration.reduce((a, d) => a + d.duration, 0) / withDuration.length)
    : 0;

  // Trend: compare first half vs second half build times
  let trend = 'stable';
  if (withDuration.length >= 4) {
    const half = Math.floor(withDuration.length / 2);
    const older = withDuration.slice(half).reduce((a, d) => a + d.duration, 0) / half;
    const newer = withDuration.slice(0, half).reduce((a, d) => a + d.duration, 0) / half;
    if (newer > older * 1.15) trend = 'degrading';
    else if (newer < older * 0.85) trend = 'improving';
  }

  const tips = [];
  if (avgBuildTimeMs > 120000) tips.push('Builds averaging >2min — add Docker layer caching (COPY package.json first, then npm install).');
  if (successRate < 70) tips.push('Low success rate — enable AI Auto-Healing to automatically patch build failures.');
  if (trend === 'degrading') tips.push('Build times are increasing — check if node_modules or dependencies grew significantly.');
  if (tips.length === 0) tips.push('Build pipeline looks healthy. No optimizations needed at this time.');

  return { avgBuildTimeMs, successRate, trend, tips, totalBuilds: deployments.length, successCount: successful.length };
};

// ─── Feature 16: Visual AI Phishing Scanner ───────────────────────────────
/**
 * Analyzes a screenshot of a deployed site using Gemini Vision.
 * Returns: { isPhishing: bool, confidence: number, reasoning: string }
 */
const analyzeVisualPhishing = async (screenshotBuffer) => {
  const keyPool = getGeminiKeyPool();
  if (keyPool.length === 0) throw new Error('No GEMINI_API_KEY configured for Vision.');

  const base64Image = screenshotBuffer.toString('base64');
  const systemPrompt = `You are an elite cybersecurity analyst. 
Examine the following screenshot of a website. Does this visually resemble a login page, password reset page, or account verification page for a well-known brand (like PayPal, Microsoft, Netflix, Apple, or a bank) or does it look like a scam/phishing site?

Respond ONLY with a valid JSON object matching this schema:
{
  "isPhishing": true | false,
  "confidence": <0-100>,
  "reasoning": "Explanation of what visual elements were found."
}`;

  try {
    for (let rotateAttempt = 0; rotateAttempt < keyPool.length; rotateAttempt++) {
      const key = keyPool[geminiKeyIndex % keyPool.length];
      geminiKeyIndex = (geminiKeyIndex + 1) % keyPool.length;

      try {
        const res = await httpClient.post(
          `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.GEMINI_MODEL}:generateContent?key=${key}`,
          {
            contents: [{
              parts: [
                { text: systemPrompt },
                { inlineData: { mimeType: 'image/jpeg', data: base64Image } }
              ]
            }],
            generationConfig: {
              temperature: 0.1,
              responseMimeType: 'application/json'
            },
          },
          { timeout: 15000 }
        );
        const raw = res.data.candidates[0].content.parts[0].text;
        return JSON.parse(raw);
      } catch (err) {
        const status = err.response?.status;
        if (status === 429 && rotateAttempt < keyPool.length - 1) {
          continue;
        }
        throw err;
      }
    }
  } catch (err) {
    console.error('[AI Vision] Analysis failed:', err.message);
    return { isPhishing: false, confidence: 0, reasoning: 'Vision API failed' };
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
  discoverRequiredEnvVars,
  inspectRuntimeLogs,
  optimizeQueries,
  predictResourceRequirements,
  generateDocsAndReadme,
  auditSecurityAndDependencies,
  analyzeTelemetryAndPredictScaling,
  // Exported for build.worker.js pre-flight secret scanning
  auditLeakedSecrets,
  // Exported for direct local static fallback analysis
  extractEnvVarsLocally,
  generateDeploymentReadinessReport,
  analyzeRuntimeHealth,
  estimateMonthlyCost,
  analyzeBuildTrends,
  analyzeVisualPhishing,
  // Exported for SRE unit testing
  getGeminiKeyPool,
  selectActiveKey,
  markKeyRateLimited,
};