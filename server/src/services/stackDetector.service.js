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
  return { name: 'npm', install: 'npm install --legacy-peer-deps || npm install', run: 'npm run', lockfile: 'package-lock.json' };
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

  const installCmd = options.installCommand || pm.install;
  const buildCmd = options.buildCommand || `${pm.run} build`;

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

  const nginxHeredocBlock = (includeProxy = false) => `\
RUN chmod -R 755 /usr/share/nginx/html && \\
    MAIN_HTML=\$(find /usr/share/nginx/html -name "*.html" -exec basename {} \\\\; | sort | head -1) && \\
    if [ -z "\\$MAIN_HTML" ]; then \\
        echo "Creating default welcome page..." && \\
        cat << 'HTML' > /usr/share/nginx/html/index.html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to LaunchPad</title>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: 'Outfit', sans-serif;
            background: linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%);
            color: #f8fafc;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
        }
        .container {
            max-width: 600px;
            padding: 40px;
            background: rgba(30, 41, 59, 0.7);
            backdrop-filter: blur(12px);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 24px;
            text-align: center;
            box-shadow: 0 20px 50px rgba(0, 0, 0, 0.3);
            z-index: 10;
        }
        h1 {
            font-size: 2.5rem;
            font-weight: 800;
            margin-bottom: 16px;
            background: linear-gradient(to right, #38bdf8, #818cf8);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }
        p {
            color: #94a3b8;
            font-size: 1.1rem;
            line-height: 1.6;
            margin-bottom: 24px;
        }
        .rocket {
            font-size: 4rem;
            margin-bottom: 20px;
            display: inline-block;
            animation: float 3s ease-in-out infinite;
        }
        .instructions {
            background: rgba(15, 23, 42, 0.5);
            padding: 20px;
            border-radius: 12px;
            text-align: left;
            margin-bottom: 24px;
            border-left: 4px solid #818cf8;
        }
        .instructions h3 {
            font-size: 1rem;
            margin-bottom: 8px;
            color: #cbd5e1;
        }
        .instructions code {
            font-family: monospace;
            color: #38bdf8;
            background: rgba(56, 189, 248, 0.1);
            padding: 2px 6px;
            border-radius: 4px;
        }
        .footer {
            color: #64748b;
            font-size: 0.9rem;
        }
        @keyframes float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="rocket">🚀</div>
        <h1>Your Site is Live on LaunchPad!</h1>
        <p>Your web container deployed successfully, but we couldn't find an HTML entry file in your repository.</p>
        <div class="instructions">
            <h3>How to publish your content:</h3>
            <p style="font-size: 0.95rem; margin-bottom: 0;">Add an <code>index.html</code> file to the root of your repository and trigger a redeploy from your LaunchPad dashboard.</p>
        </div>
        <div class="footer">
            Powered by LaunchPad Serverless Containers
        </div>
    </div>
</body>
</html>
HTML
        MAIN_HTML="index.html" ; \\
    fi && \\
    cat << EOF > /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    root /usr/share/nginx/html;
    index $MAIN_HTML;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline' 'unsafe-eval'; img-src 'self' data: https:; connect-src 'self' https: wss:;" always;

    # Advanced Gzip Compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_min_length 256;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml+rss image/svg+xml;
    
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, no-transform";
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
    }${includeProxy ? `\n
    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection upgrade;
        proxy_set_header Host \\$host;
    }
    location /socket.io/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\$http_upgrade;
        proxy_set_header Connection upgrade;
    }` : ''}

    # Clean URLs & Single Page Application Routing
    location / {
        try_files \\$uri \\$uri/ \\$uri.html /$MAIN_HTML;
    }
}
EOF`;

  const healthCheck = 'HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/ || exit 1';

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
RUN ${installCmd}
COPY . .
${envArgs}
RUN ${buildCmd}

FROM nginx:alpine
RUN apk add --no-cache curl
RUN rm -rf /usr/share/nginx/html/*
COPY --from=builder /app/${outDir} /usr/share/nginx/html
${nginxHeredocBlock(false)}
EXPOSE 3000
${healthCheck}
CMD ["nginx", "-g", "daemon off;"]`;
    }

    case 'next': {
      const lockFile = exists(repoPath, pm.lockfile) ? pm.lockfile : '';
      return `FROM node:20-alpine AS builder
WORKDIR /app
${pmSetup}
COPY package*.json ${lockFile} ./
RUN ${installCmd}
COPY . .
${envArgs}
RUN ${buildCmd}

FROM node:20-alpine
RUN apk add --no-cache curl tini
WORKDIR /app
ENV PORT=3000
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
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
EXPOSE 3000
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

      const start = getStartCommand(path.join(repoPath, beDir), pm.name);
      const runCmd = start.isScript ? `CMD ["${pm.name}", "start"]` : `CMD ["node", "${start.args[0]}"]`;

      return `# ── Stage 1: Build Frontend ──
FROM node:20-alpine AS fe-builder
WORKDIR /app/frontend
${pmSetup}
COPY ${feDir}/package*.json${feLockStr} ./
RUN ${installCmd}
COPY ${feDir}/ .
${envArgs}
RUN ${buildCmd} 2>/dev/null || npx vite build || true

# ── Stage 2: Final single-process backend image ──
FROM node:20-alpine
RUN apk add --no-cache curl tini
WORKDIR /app
COPY ${beDir}/package*.json${beLockStr} ./
RUN npm install --only=production --legacy-peer-deps 2>/dev/null || npm install --only=production || ${installCmd}
COPY ${beDir}/ .

# Copy frontend static build to backend's public directories for serving
COPY --from=fe-builder /app/frontend/${feOut} ./public

ENV PORT=3000
ENV NODE_ENV=production
EXPOSE 3000
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
${runCmd}`;
    }

    case 'node':
    default: {
      const start = getStartCommand(repoPath, pm.name);
      const runCmd = start.isScript ? `CMD ["${pm.name}", "start"]` : `CMD ["node", "${start.args[0]}"]`;
      return `FROM node:20-alpine
RUN apk add --no-cache curl tini
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps || npm install --only=production
COPY . .
ENV PORT=3000
EXPOSE 3000
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
${runCmd}`;
    }
  }
};

module.exports = { detectStack, generateDockerfile, getStartCommand, detectPackageManager };