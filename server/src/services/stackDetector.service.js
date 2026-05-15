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
  try { return fs.readdirSync(dir).filter(f => f.endsWith('.html')); }
  catch { return []; }
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
  const buildScript = pkg?.scripts?.build || '';
  if (hasDep(pkg, 'vite') || buildScript.includes('vite')) return 'dist';
  if (hasDep(pkg, 'next') || buildScript.includes('next build')) return '.next';
  if (buildScript.includes('react-scripts')) return 'build';
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
  if (hasFrontendDir && hasBackendDir) return 'fullstack-split';

  if ((hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify')) && (hasDep(rootPkg, 'react') || hasFrontendDir)) {
    return 'mern';
  }

  if (hasDep(rootPkg, 'react') || hasDep(rootPkg, 'vite') || scripts.build) return 'react';
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
    MAIN_HTML=$(find /usr/share/nginx/html -name "*.html" -exec basename {} \\; | sort | head -1) && \\
    MAIN_HTML=\${MAIN_HTML:-index.html} && \\
    cat << EOF > /etc/nginx/conf.d/default.conf
server {
    listen 3000;
    root /usr/share/nginx/html;
    index $MAIN_HTML;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml;
    
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control public;
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

    location / {
        try_files \\$uri \\$uri/ /$MAIN_HTML;
    }
}
EOF`;

  const healthCheck = 'HEALTHCHECK --interval=30s --timeout=3s CMD curl -f http://localhost:3000/ || exit 1';

  switch (type) {
    case 'react': {
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
RUN apk add --no-cache curl
WORKDIR /app
ENV PORT=3000
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
${healthCheck}
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

      const start = getStartCommand(path.join(repoPath, beDir), pm.name);
      const beStartCmd = start.isScript ? `${pm.name} start` : `node ${start.args[0]}`;

      return `# ── Stage 1: Build Frontend ──
FROM node:20-alpine AS fe-builder
WORKDIR /app/frontend
${pmSetup}
COPY ${feDir}/package*.json ${feLock} ./
RUN ${installCmd}
COPY ${feDir}/ .
${envArgs}
RUN ${buildCmd} 2>/dev/null || echo "no-build"

# ── Stage 2: Build Backend deps ──
FROM node:20-alpine AS be-builder
WORKDIR /app/backend
COPY ${beDir}/package*.json ${beLock} ./
RUN npm install --only=production --legacy-peer-deps || npm install --only=production

# ── Stage 3: Final image (nginx + node) ──
FROM nginx:alpine
RUN apk add --no-cache nodejs npm curl

WORKDIR /app/backend
COPY --from=be-builder /app/backend/node_modules ./node_modules
COPY ${beDir}/ .

COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html

${nginxHeredocBlock(true)}

RUN cat << 'EOF' > /start.sh
#!/bin/sh
cd /app/backend && PORT=4000 ${beStartCmd} &
nginx -g "daemon off;"
EOF
RUN chmod +x /start.sh

EXPOSE 3000
${healthCheck}
CMD ["/start.sh"]`;
    }

    case 'node':
    default: {
      const start = getStartCommand(repoPath, pm.name);
      const runCmd = start.isScript ? `CMD ["${pm.name}", "start"]` : `CMD ["node", "${start.args[0]}"]`;
      return `FROM node:20-alpine
RUN apk add --no-cache curl
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps || npm install --only=production
COPY . .
ENV PORT=3000
EXPOSE 3000
${healthCheck}
${runCmd}`;
    }
  }
};

module.exports = { detectStack, generateDockerfile, getStartCommand, detectPackageManager };