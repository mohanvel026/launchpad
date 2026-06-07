const fs = require('fs');
const path = require('path');

// ─── Core Helpers ─────────────────────────────────────────────────────────────
const exists = (base, f) => fs.existsSync(path.join(base, f));
const readPkg = (base, f = 'package.json') => {
  try { return JSON.parse(fs.readFileSync(path.join(base, f), 'utf-8')); }
  catch { return null; }
};
const allDeps = (pkg) => ({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) });
const hasDep = (pkg, dep) => dep in allDeps(pkg);
const getHtmlFiles = (dir) => {
  try {
    let files = [];
    const candidates = ['', 'public', 'src', 'dist', 'app'];
    for (const sub of candidates) {
      const p = path.join(dir, sub);
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        const found = fs.readdirSync(p).filter(f => f.endsWith('.html'));
        files = files.concat(found);
      }
    }
    return files;
  } catch {
    return [];
  }
};

// ─── Tooling Detection (Package Manager & Build) ──────────────────────────────
const detectPackageManager = (dir) => {
  if (exists(dir, 'pnpm-lock.yaml')) return { name: 'pnpm', install: 'pnpm install', run: 'pnpm run', lockfile: 'pnpm-lock.yaml' };
  if (exists(dir, 'yarn.lock')) return { name: 'yarn', install: 'yarn install', run: 'yarn', lockfile: 'yarn.lock' };
  if (exists(dir, 'bun.lockb')) return { name: 'bun', install: 'bun install', run: 'bun run', lockfile: 'bun.lockb' };
  return { name: 'npm', install: 'npm ci --legacy-peer-deps || npm install --legacy-peer-deps || npm install', run: 'npm run', lockfile: 'package-lock.json' };
};

const getStartCommand = (dir, pmName = 'npm') => {
  const pkg = readPkg(dir);
  const runner = pmName === 'npm' ? 'npm' : pmName;
  if (pkg?.scripts?.start) return { cmd: runner, args: ['start'], isScript: true };

  const candidates = ['server.js', 'index.js', 'app.js', 'main.js', 'src/server.js', 'src/index.js'];
  for (const f of candidates) {
    if (exists(dir, f)) return { cmd: 'node', args: [f], isScript: false };
  }
  return { cmd: runner, args: ['start'], isScript: true };
};

const getBuildOutput = (dir) => {
  const pkg = readPkg(dir);
  if (!pkg) return 'dist'; // Fallback for pure static sites without package.json

  const buildScript = pkg?.scripts?.build || '';
  
  // Framework specific detections
  if (hasDep(pkg, 'astro') || buildScript.includes('astro build')) return 'dist';
  if (hasDep(pkg, '@sveltejs/kit') || hasDep(pkg, 'svelte')) {
    // SvelteKit static adapter compiles to 'build', standard Svelte builds to 'dist'
    return exists(dir, 'build') ? 'build' : 'dist';
  }
  if (hasDep(pkg, 'vue') || buildScript.includes('vue-cli-service build')) return 'dist';
  if (hasDep(pkg, 'nuxt') || buildScript.includes('nuxt build')) return '.output/public';
  if (hasDep(pkg, 'gatsby') || buildScript.includes('gatsby build')) return 'public';
  
  // Angular usually outputs to dist/<project-name>
  if (hasDep(pkg, '@angular/core')) {
    try {
      const angularJson = JSON.parse(fs.readFileSync(path.join(dir, 'angular.json'), 'utf-8'));
      const defaultProject = angularJson.defaultProject || Object.keys(angularJson.projects)[0];
      const outputPath = angularJson.projects[defaultProject]?.architect?.build?.options?.outputPath;
      if (outputPath) {
        return outputPath;
      }
    } catch {}
    return 'dist';
  }

  if (hasDep(pkg, 'vite') || buildScript.includes('vite')) return 'dist';
  if (hasDep(pkg, 'next') || buildScript.includes('next build')) return '.next';
  if (buildScript.includes('react-scripts')) return 'build';

  // Filesystem fallback check
  const candidates = ['dist', 'build', 'public', 'out', '.output/public'];
  for (const c of candidates) {
    if (exists(dir, c)) return c;
  }

  return 'dist'; 
};

// ─── Stack Analysis ───────────────────────────────────────────────────────────
// Restored to return STRICTLY A STRING so pipeline `.toUpperCase()` doesn't crash
const detectStack = (repoPath) => {
  const rootPkg = readPkg(repoPath);
  
  const hasFrontendDir = exists(repoPath, 'frontend') || exists(repoPath, 'client');
  const hasBackendDir = exists(repoPath, 'backend') || exists(repoPath, 'server');
  const hasHtmlFile = getHtmlFiles(repoPath).length > 0;

  if (!rootPkg) {
    if (hasFrontendDir && hasBackendDir) return 'fullstack-split';
    if (hasFrontendDir) return 'react';
    if (hasBackendDir) return 'node';
    return 'static';
  }

  const scripts = rootPkg.scripts || {};
  if (hasDep(rootPkg, 'next')) return 'next';
  if (hasDep(rootPkg, 'nuxt')) return 'nuxt';
  if (hasDep(rootPkg, 'astro')) return 'astro';
  if (hasDep(rootPkg, '@sveltejs/kit') || hasDep(rootPkg, 'svelte')) return 'svelte';
  if (hasDep(rootPkg, 'vue')) return 'vue';
  if (hasDep(rootPkg, '@angular/core')) return 'angular';
  
  if (hasFrontendDir && hasBackendDir) return 'fullstack-split';

  if ((hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify')) && (hasDep(rootPkg, 'react') || hasFrontendDir)) {
    return 'mern';
  }

  if (hasDep(rootPkg, 'react') || hasDep(rootPkg, 'vue') || hasDep(rootPkg, 'svelte') || hasDep(rootPkg, 'astro') || hasDep(rootPkg, 'angular') || hasDep(rootPkg, 'vite') || scripts.build) {
    return 'react'; // React, Vue, Svelte, Astro, Angular compile into static-served containers
  }
  
  if (hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify') || scripts.start) return 'node';

  return hasHtmlFile ? 'static' : 'node';
};

// ─── Dockerfile Generation ────────────────────────────────────────────────────
const generateDockerfile = (stack, repoPath = '', options = {}) => {
  // If stack is passed as string use it, otherwise detect it.
  const type = (stack && typeof stack === 'string') ? stack : detectStack(repoPath);
  
  // Detect package manager directly here instead of relying on detectStack
  const pm = detectPackageManager(repoPath);

  const containerPort = options.containerPort || 3000;

  const installCmd = options.installCommand || pm.install;
  const buildCmd = options.buildCommand || `${pm.run} build`;

  let installRunInstruction = `RUN ${installCmd}`;
  if (!options.installCommand) {
    if (pm.name === 'npm') {
      installRunInstruction = `RUN --mount=type=cache,target=/root/.npm ${pm.install}`;
    } else if (pm.name === 'pnpm') {
      installRunInstruction = `RUN --mount=type=cache,target=/root/.local/share/pnpm/store ${pm.install}`;
    } else if (pm.name === 'yarn') {
      installRunInstruction = `RUN --mount=type=cache,target=/root/.yarn YARN_CACHE_FOLDER=/root/.yarn ${pm.install}`;
    } else if (pm.name === 'bun') {
      installRunInstruction = `RUN --mount=type=cache,target=/root/.bun ${pm.install}`;
    }
  }

  // PM Setup logic for non-NPM managers
  let pmSetup = '';
  if (pm.name === 'yarn') pmSetup = 'RUN corepack enable && corepack prepare yarn@stable --activate';
  if (pm.name === 'pnpm') pmSetup = 'RUN corepack enable && corepack prepare pnpm@latest --activate';
  if (pm.name === 'bun')  pmSetup = 'RUN npm install -g bun';

  // Dynamically generate ARG and ENV blocks for all user-defined variables
  const envVars = options.envVars || [];
  const envArgs = envVars
    .map(e => `ARG ${e.key}=""\nENV ${e.key}=$${e.key}`)
    .join('\n');

  // ── Nginx Config Builder (base64-encoded — no heredocs, works with all Docker versions) ──
  const nginxHeredocBlock = (includeProxy = false) => {
    const proxySection = includeProxy ? `
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host $host;
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection upgrade;
    }` : '';

    // Nginx config — uses MAIN_HTML_PLACEHOLDER which gets sed-replaced at container startup
    const nginxConf = `server {
    listen ${containerPort};
    root /usr/share/nginx/html;
    index MAIN_HTML_PLACEHOLDER;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;

    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 256;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml+rss image/svg+xml;

    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, no-transform";
    }${proxySection}

    location / {
        try_files $uri $uri/ $uri.html /MAIN_HTML_PLACEHOLDER;
    }
}`;

    // LaunchPad fallback landing page shown when the repo has no HTML files
    const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to LaunchPad</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:'Outfit',sans-serif;background:linear-gradient(135deg,#0f172a 0%,#1e1b4b 100%);color:#f8fafc;min-height:100vh;display:flex;align-items:center;justify-content:center}
        .container{max-width:600px;padding:40px;background:rgba(30,41,59,0.7);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.1);border-radius:24px;text-align:center;box-shadow:0 20px 50px rgba(0,0,0,0.3)}
        h1{font-size:2.5rem;font-weight:800;margin-bottom:16px;background:linear-gradient(to right,#38bdf8,#818cf8);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
        p{color:#94a3b8;font-size:1.1rem;line-height:1.6;margin-bottom:24px}
        .rocket{font-size:4rem;margin-bottom:20px;display:inline-block;animation:float 3s ease-in-out infinite}
        .instructions{background:rgba(15,23,42,0.5);padding:20px;border-radius:12px;text-align:left;margin-bottom:24px;border-left:4px solid #818cf8}
        .instructions h3{font-size:1rem;margin-bottom:8px;color:#cbd5e1}
        .instructions code{font-family:monospace;color:#38bdf8;background:rgba(56,189,248,0.1);padding:2px 6px;border-radius:4px}
        .footer{color:#64748b;font-size:0.9rem}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
    </style>
</head>
<body>
    <div class="container">
        <div class="rocket">&#x1F680;</div>
        <h1>Your Site is Live on LaunchPad!</h1>
        <p>Your container deployed successfully. Add an <code>index.html</code> to your repo and redeploy to publish your content.</p>
        <div class="instructions">
            <h3>How to publish your content:</h3>
            <p style="font-size:0.95rem;margin-bottom:0">Add an <code>index.html</code> file to the root of your repository and trigger a redeploy from your LaunchPad dashboard.</p>
        </div>
        <div class="footer">Powered by LaunchPad Serverless Containers</div>
    </div>
</body>
</html>`;

    const b64Nginx   = Buffer.from(nginxConf).toString('base64');
    const b64Html    = Buffer.from(fallbackHtml).toString('base64');

    const configDir = includeProxy ? '/etc/nginx/http.d' : '/etc/nginx/conf.d';
    const configFile = `${configDir}/default.conf`;
    const deleteOldFile = includeProxy ? '/etc/nginx/conf.d/default.conf' : '/etc/nginx/http.d/default.conf';

    // Single RUN command — no heredocs, no xargs, works on all Alpine/BusyBox Docker versions
    return `RUN chmod -R 755 /usr/share/nginx/html; \\
    _LP_F=$(find /usr/share/nginx/html -name "index.html" 2>/dev/null | head -1); \\
    if [ -z "$_LP_F" ]; then _LP_F=$(find /usr/share/nginx/html -name "*.html" 2>/dev/null | head -1); fi; \\
    if [ -n "$_LP_F" ]; then MAIN_HTML=$(basename "$_LP_F"); else MAIN_HTML=""; fi; \\
    if [ -z "$MAIN_HTML" ]; then \\
        printf '%s' '${b64Html}' | base64 -d > /usr/share/nginx/html/index.html; \\
        MAIN_HTML="index.html"; \\
    fi; \\
    mkdir -p ${configDir}; \\
    rm -f ${deleteOldFile}; \\
    printf '%s' '${b64Nginx}' | base64 -d | sed "s|MAIN_HTML_PLACEHOLDER|$MAIN_HTML|g" > ${configFile}`;
  };

  const healthCheck = `HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:${containerPort}/ || exit 1`;

  switch (type) {
    case 'react':
    case 'vue':
    case 'svelte':
    case 'astro':
    case 'angular': {
      const outDir = options.outputDir || (repoPath ? getBuildOutput(repoPath) : 'dist');
      const lockFile = exists(repoPath, pm.lockfile) ? pm.lockfile : '';
      return `FROM node:20-alpine AS builder
WORKDIR /app
${pmSetup}
COPY package*.json ${lockFile} ./
${installRunInstruction}
COPY . .
${envArgs}
RUN ${buildCmd}

FROM nginx:alpine
RUN apk add --no-cache curl
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/${outDir} /usr/share/nginx/html
${nginxHeredocBlock(false)}
EXPOSE ${containerPort}
${healthCheck}
CMD ["nginx", "-g", "daemon off;"]`;
    }

    case 'next': {
      const lockFile = exists(repoPath, pm.lockfile) ? pm.lockfile : '';
      return `FROM node:20-alpine AS builder
WORKDIR /app
${pmSetup}
COPY package*.json ${lockFile} ./
${installRunInstruction}
COPY . .
${envArgs}
RUN ${buildCmd}

FROM node:20-alpine
RUN apk add --no-cache curl tini
WORKDIR /app
ENV PORT=${containerPort}
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["${pm.name}", "start"]`;
    }

    case 'static':
      return `FROM nginx:alpine
RUN apk add --no-cache curl
RUN rm -rf /usr/share/nginx/html/*
COPY . /usr/share/nginx/html
${nginxHeredocBlock(false)}
EXPOSE ${containerPort}
${healthCheck}
CMD ["nginx", "-g", "daemon off;"]`;

    case 'mern':
    case 'fullstack-split': {
      const feDir = exists(repoPath, 'client') ? 'client' : (exists(repoPath, 'frontend') ? 'frontend' : '.');
      const beDir = exists(repoPath, 'server') ? 'server' : (exists(repoPath, 'backend') ? 'backend' : '.');
      const feOut = options.outputDir || (repoPath ? getBuildOutput(path.join(repoPath, feDir)) : 'dist');
      
      const feLock = exists(path.join(repoPath, feDir), pm.lockfile) ? `${feDir}/${pm.lockfile}` : '';
      const beLock = exists(path.join(repoPath, beDir), pm.lockfile) ? `${beDir}/${pm.lockfile}` : '';

      const feLockStr = feLock ? ` ${feLock}` : '';
      const beLockStr = beLock ? ` ${beLock}` : '';

      const bePkg = readPkg(path.join(repoPath, beDir));
      const hasPrisma = hasDep(bePkg, 'prisma') || hasDep(bePkg, '@prisma/client');
      const prismaGen = hasPrisma ? `\nCOPY ${beDir}/prisma* ./prisma/\nRUN npx prisma generate || true` : '';

      const start = getStartCommand(path.join(repoPath, beDir), pm.name);
      const backendCmd = start.isScript
        ? `pm2 start ${pm.name} --name backend -- start`
        : `pm2 start ${start.args[0]} --name backend`;

      // Backend cache mount — matches pm cache dir
      const beCacheMount = pm.name === 'npm' ? '--mount=type=cache,target=/root/.npm' :
                           pm.name === 'pnpm' ? '--mount=type=cache,target=/root/.local/share/pnpm/store' :
                           pm.name === 'yarn' ? '--mount=type=cache,target=/root/.yarn' : '';
      const beInstallCmd = `RUN ${beCacheMount} npm install --only=production --legacy-peer-deps 2>/dev/null || npm install --only=production || ${installCmd}`;

      return `# ── Stage 1: Build Frontend (runs in PARALLEL with Stage 2) ──
FROM node:20-alpine AS fe-builder
WORKDIR /app/frontend
${pmSetup}
COPY ${feDir}/package*.json${feLockStr} ./
${installRunInstruction}
COPY ${feDir}/ .
${envArgs}
RUN ${buildCmd} 2>/dev/null || npx vite build || true

# ── Stage 2: Install Backend Dependencies (runs in PARALLEL with Stage 1) ──
FROM node:20-alpine AS be-builder
WORKDIR /app
${pmSetup}
COPY ${beDir}/package*.json${beLockStr} ./
${beInstallCmd}
COPY ${beDir}/ .${prismaGen}

# ── Stage 3: Final SRE container — assembles from both parallel stages ──
FROM node:20-alpine
RUN apk add --no-cache curl nginx tini
RUN npm install -g pm2 --silent

WORKDIR /app
# Pull in pre-built backend (deps + source + prisma client)
COPY --from=be-builder /app ./
# Copy built frontend into Nginx html directory
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html

# Write Nginx configuration with reverse proxy enabled for /api and /socket.io
${nginxHeredocBlock(true)}

ENV PORT=4000
ENV NODE_ENV=production
EXPOSE ${containerPort}
${healthCheck}
# Write a clean startup script — avoids all shell quoting / JSON escaping issues in CMD
RUN printf '#!/bin/sh\\nset -e\\n${backendCmd}\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
    }

    case 'nuxt': {
      const lockFile = exists(repoPath, pm.lockfile) ? pm.lockfile : '';
      return `FROM node:20-alpine AS builder
WORKDIR /app
${pmSetup}
COPY package*.json ${lockFile} ./
${installRunInstruction}
COPY . .
${envArgs}
RUN ${buildCmd} 2>/dev/null || npx nuxt build || true

FROM node:20-alpine
RUN apk add --no-cache curl tini
WORKDIR /app
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package*.json ./
ENV PORT=${containerPort}
ENV NODE_ENV=production
ENV NITRO_PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", ".output/server/index.mjs"]`;
    }

    case 'node':
    default: {
      const rootPkg = readPkg(repoPath);
      const hasPrisma = hasDep(rootPkg, 'prisma') || hasDep(rootPkg, '@prisma/client');
      const prismaGen = hasPrisma ? `\nRUN npx prisma generate || true` : '';

      const start = getStartCommand(repoPath, pm.name);
      const lockFile = exists(repoPath, pm.lockfile) ? pm.lockfile : '';
      const lockFileCopy = lockFile ? `COPY ${lockFile} ./` : '';
      const runCmd = start.isScript ? `CMD ["${pm.name}", "start"]` : `CMD ["node", "${start.args[0]}"]`;
      return `FROM node:20-alpine
RUN apk add --no-cache curl tini
WORKDIR /app
COPY package*.json ./
${lockFileCopy}
${installRunInstruction}
COPY . .${prismaGen}
ENV PORT=${containerPort}
ENV NODE_ENV=production
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
${runCmd}`;
    }
  }
};

module.exports = { detectStack, generateDockerfile, getStartCommand, detectPackageManager };