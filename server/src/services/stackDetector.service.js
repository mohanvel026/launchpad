const fs   = require('fs');
const path = require('path');

// ─── Helpers ──────────────────────────────────────────────────────────────────
const exists  = (base, f) => fs.existsSync(path.join(base, f));
const readPkg = (base, f = 'package.json') => {
  try { return JSON.parse(fs.readFileSync(path.join(base, f), 'utf-8')); }
  catch { return null; }
};
const allDeps = (pkg) => ({ ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) });
const hasDep  = (pkg, dep) => dep in allDeps(pkg);

// ─── Find the best start command for a Node backend ──────────────────────────
const getStartCommand = (dir) => {
  const pkg = readPkg(dir);
  if (pkg?.scripts?.start) return { cmd: 'npm', args: ['start'], useNpm: true };
  
  const candidates = [
    'server.js', 'index.js', 'app.js', 'main.js',
    'src/server.js', 'src/index.js', 'src/app.js', 'src/main.js'
  ];
  for (const f of candidates) {
    if (exists(dir, f)) return { cmd: 'node', args: [f], useNpm: false };
  }
  
  // Fallback to a generic node entry or npm start
  return { cmd: 'npm', args: ['start'], useNpm: true };
};

const getBuildOutput = (dir) => {
  const pkg = readPkg(dir);
  const buildScript = pkg?.scripts?.build || '';
  if (hasDep(pkg, 'vite') || buildScript.includes('vite')) return 'dist';
  if (hasDep(pkg, 'next') || buildScript.includes('next build')) return '.next';
  if (buildScript.includes('react-scripts')) return 'build';
  return 'dist';
};

// ─── Stack Detection ──────────────────────────────────────────────────────────
const detectStack = (repoPath) => {
  const rootPkg = readPkg(repoPath);
  const hasFrontendDir = exists(repoPath, 'frontend') || exists(repoPath, 'client');
  const hasBackendDir  = exists(repoPath, 'backend')  || exists(repoPath, 'server');
  const hasIndexHtml   = exists(repoPath, 'index.html');

  if (!rootPkg) {
    if (hasFrontendDir && hasBackendDir) return 'fullstack-split';
    if (hasFrontendDir) return 'react';
    if (hasBackendDir)  return 'node';
    return 'static';
  }

  const scripts = rootPkg.scripts || {};
  if (hasDep(rootPkg, 'next')) return 'next';
  if (hasDep(rootPkg, 'nuxt')) return 'nuxt';
  if (hasFrontendDir && hasBackendDir) return 'fullstack-split';
  
  // MERN Detection (Monorepo-ish)
  if ((hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify')) && (hasDep(rootPkg, 'react') || hasFrontendDir)) {
    return 'mern';
  }

  if (hasDep(rootPkg, 'react') || hasDep(rootPkg, 'vite') || scripts.build) return 'react';
  if (hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify') || scripts.start) return 'node';
  
  return hasIndexHtml ? 'static' : 'node';
};

// Writes nginx config inside a Docker image using reliable one-echo-per-line approach.
// Single-quoted echo means shell NEVER expands $uri, $host, etc.
// Far more reliable than printf with multi-line strings across sh/ash/bash.
const nginxWriteCmd = (port = 3000) => [
  `echo 'server {'`,
  `echo '    listen ${port};'`,
  `echo '    root /usr/share/nginx/html;'`,
  `echo '    index index.html;'`,
  `echo '    gzip on;'`,
  `echo '    gzip_types text/plain text/css application/json application/javascript text/xml;'`,
  `echo '    location ~* .(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {'`,
  `echo '        expires 1y;'`,
  `echo '        add_header Cache-Control public;'`,
  `echo '    }'`,
  `echo '    location / {'`,
  `echo '        try_files $uri $uri/ /index.html;'`,
  `echo '    }'`,
  `echo '}'`,
]
  .map((cmd, i) => `${cmd} ${i === 0 ? '>' : '>>'} /etc/nginx/conf.d/app.conf`)
  .join(' \
 && ');

// ─── Dockerfile Generation ────────────────────────────────────────────────────
const generateDockerfile = (stack, repoPath = '', options = {}) => {
  const { 
    installCommand = 'npm install', 
    buildCommand = 'npm run build', 
    outputDir 
  } = options;

  const buildArgBlock = `\
ARG VITE_API_URL=""
ARG REACT_APP_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL`;

  switch (stack) {
    case 'react': {
      const outDir = outputDir || (repoPath ? getBuildOutput(repoPath) : 'dist');
      return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN ${installCommand} --legacy-peer-deps || ${installCommand}
COPY . .
${buildArgBlock}
RUN ${buildCommand}
FROM nginx:alpine
RUN rm -f /etc/nginx/conf.d/default.conf
RUN ${nginxWriteCmd(3000)}
COPY --from=builder /app/${outDir} /usr/share/nginx/html
# Auto-create index.html if missing
RUN if [ ! -f /usr/share/nginx/html/index.html ]; then \\
      FOUND=$(find /usr/share/nginx/html -maxdepth 1 -name "*.html" | sort | head -1); \\
      if [ -n "$FOUND" ]; then cp "$FOUND" /usr/share/nginx/html/index.html; \\
      else echo '<meta http-equiv="refresh" content="0;url=/404.html">' > /usr/share/nginx/html/index.html; fi; \\
    fi
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]`;
    }

    case 'next':
      return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN ${installCommand} --legacy-peer-deps || ${installCommand}
COPY . .
${buildArgBlock}
RUN ${buildCommand}
FROM node:20-alpine
WORKDIR /app
ENV PORT=3000
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "start"]`;

    case 'static':
      return `FROM nginx:alpine
RUN rm -f /etc/nginx/conf.d/default.conf
RUN ${nginxWriteCmd(3000)}
COPY . /usr/share/nginx/html
# Auto-create index.html if missing (e.g. repo has portfolio.html instead)
RUN if [ ! -f /usr/share/nginx/html/index.html ]; then \\
      FOUND=$(find /usr/share/nginx/html -maxdepth 1 -name "*.html" | sort | head -1); \\
      if [ -n "$FOUND" ]; then cp "$FOUND" /usr/share/nginx/html/index.html; \\
      else echo '<meta http-equiv="refresh" content="0;url=/404.html">' > /usr/share/nginx/html/index.html; fi; \\
    fi
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]`;

    case 'mern':
    case 'fullstack-split': {
      const feDir = exists(repoPath, 'client') ? 'client' : (exists(repoPath, 'frontend') ? 'frontend' : '.');
      const beDir = exists(repoPath, 'server') ? 'server' : (exists(repoPath, 'backend') ? 'backend' : '.');
      const feOut = outputDir || (repoPath ? getBuildOutput(path.join(repoPath, feDir)) : 'dist');
      const start = getStartCommand(path.join(repoPath, beDir));
      const beStartCmd = start.useNpm ? 'npm start' : `node ${start.args[0]}`;

      // Use nginx as the public-facing server on port 3000.
      // nginx serves the React frontend and reverse-proxies /api/* to the
      // Node backend running internally on port 4000 — no changes needed
      // in the user's own code.
      return `# ── Stage 1: Build Frontend ──
FROM node:20-alpine AS fe-builder
WORKDIR /app/frontend
COPY ${feDir}/package*.json ./
RUN npm install --legacy-peer-deps || npm install
COPY ${feDir}/ .
${buildArgBlock}
RUN npm run build 2>/dev/null || echo "no-build"

# ── Stage 2: Build Backend deps ──
FROM node:20-alpine AS be-builder
WORKDIR /app/backend
COPY ${beDir}/package*.json ./
RUN npm install --only=production --legacy-peer-deps || npm install --only=production

# ── Stage 3: Final image (nginx + node) ──
FROM nginx:alpine
RUN apk add --no-cache nodejs npm

# Backend
WORKDIR /app/backend
COPY --from=be-builder /app/backend/node_modules ./node_modules
COPY ${beDir}/ .

# Frontend
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html

# nginx config: serve frontend + proxy /api to node on port 4000
RUN printf 'server {\n  listen 3000;\n  root /usr/share/nginx/html;\n  index index.html;\n  location /api/ {\n    proxy_pass http://127.0.0.1:4000;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection upgrade;\n    proxy_set_header Host $host;\n  }\n  location /socket.io/ {\n    proxy_pass http://127.0.0.1:4000;\n    proxy_http_version 1.1;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection upgrade;\n  }\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' > /etc/nginx/conf.d/default.conf

# Entrypoint: start node backend then nginx
RUN printf '#!/bin/sh\ncd /app/backend && PORT=4000 ${beStartCmd} &\nnginx -g "daemon off;"\n' > /start.sh && chmod +x /start.sh

EXPOSE 3000
CMD ["/start.sh"]`;
    }

    case 'node':
    default: {
      const start = repoPath ? getStartCommand(repoPath) : { cmd: 'npm', args: ['start'], useNpm: true };
      const runCmd = start.useNpm ? `CMD ["npm", "start"]` : `CMD ["node", "${start.args[0]}"]`;
      return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN ${installCommand} --only=production --legacy-peer-deps || ${installCommand} --only=production
COPY . .
ENV PORT=3000
EXPOSE 3000
${runCmd}`;
    }
  }
};

module.exports = { detectStack, generateDockerfile, getStartCommand };