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

  // 1. If package.json has a "start" script, use npm start (most reliable)
  if (pkg?.scripts?.start) {
    return { cmd: 'npm', args: ['start'], useNpm: true };
  }

  // 2. Search for common entry files
  const candidates = [
    'server.js', 'index.js', 'app.js', 'main.js',
    'src/server.js', 'src/index.js', 'src/app.js', 'src/main.js',
    'dist/server.js', 'dist/index.js',
  ];
  for (const f of candidates) {
    if (exists(dir, f)) return { cmd: 'node', args: [f], useNpm: false };
  }

  // 3. Use "main" field from package.json
  if (pkg?.main && exists(dir, pkg.main)) {
    return { cmd: 'node', args: [pkg.main], useNpm: false };
  }

  // 4. Last resort: npm start (will fail gracefully if no script)
  return { cmd: 'npm', args: ['start'], useNpm: true };
};

// ─── Detect the frontend build output directory ───────────────────────────────
const getBuildOutput = (dir) => {
  const pkg = readPkg(dir);
  const buildScript = pkg?.scripts?.build || '';

  // Vite outputs to dist/ by default
  if (hasDep(pkg, 'vite') || buildScript.includes('vite')) return 'dist';
  // CRA outputs to build/
  if (buildScript.includes('react-scripts')) return 'build';
  // Angular outputs to dist/<project-name>
  if (hasDep(pkg, '@angular/core')) return 'dist';
  // Default: try dist then build
  return 'dist';
};

// ─── Stack Detection ──────────────────────────────────────────────────────────
const detectStack = (repoPath) => {
  const rootPkg = readPkg(repoPath);
  const deps    = allDeps(rootPkg);
  const scripts = rootPkg?.scripts || {};

  // Directory structure flags
  const hasFrontendDir = exists(repoPath, 'frontend');
  const hasBackendDir  = exists(repoPath, 'backend');
  const hasClientDir   = exists(repoPath, 'client');
  const hasServerDir   = exists(repoPath, 'server');

  // File flags
  const hasIndexHtml   = exists(repoPath, 'index.html');
  const hasServerJs    = exists(repoPath, 'server.js');
  const hasIndexJs     = exists(repoPath, 'index.js');
  const hasAppJs       = exists(repoPath, 'app.js');
  const hasSrcMain     = exists(repoPath, 'src/main.ts') || exists(repoPath, 'src/main.tsx') || exists(repoPath, 'src/index.tsx') || exists(repoPath, 'src/index.jsx');

  // ── No root package.json → detect by directory structure ──────────────────
  if (!rootPkg) {
    if ((hasFrontendDir || hasClientDir) && (hasBackendDir || hasServerDir)) {
      return 'fullstack-split';
    }
    if (hasFrontendDir || hasClientDir) {
      const fePkg = readPkg(repoPath, hasFrontendDir ? 'frontend/package.json' : 'client/package.json');
      if (hasDep(fePkg, 'next')) return 'next';
      if (hasDep(fePkg, 'nuxt')) return 'nuxt';
      return 'react';
    }
    if (hasBackendDir || hasServerDir) return 'node';
    if (hasIndexHtml) return 'static';
    return 'static';
  }

  // ── Next.js (must check before react) ─────────────────────────────────────
  if (hasDep(rootPkg, 'next')) return 'next';

  // ── Nuxt.js ───────────────────────────────────────────────────────────────
  if (hasDep(rootPkg, 'nuxt') || hasDep(rootPkg, '@nuxt/core')) return 'nuxt';

  // ── Full-stack split: has both a frontend and backend subdirectory ─────────
  if ((hasFrontendDir || hasClientDir) && (hasBackendDir || hasServerDir)) {
    return 'fullstack-split';
  }

  // ── MERN: Express backend + React/Mongoose in same package.json ───────────
  if (
    (hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify')) &&
    (hasDep(rootPkg, 'mongoose') || hasDep(rootPkg, '@prisma/client') || hasDep(rootPkg, 'sequelize')) &&
    (hasDep(rootPkg, 'react') || hasClientDir || hasFrontendDir)
  ) {
    return 'mern';
  }

  // ── Pure Frontend Frameworks ───────────────────────────────────────────────
  if (hasDep(rootPkg, 'react') || hasDep(rootPkg, 'vite')) return 'react';
  if (hasDep(rootPkg, 'vue'))    return 'react'; // same build process
  if (hasDep(rootPkg, 'svelte')) return 'react';
  if (hasDep(rootPkg, '@angular/core')) return 'react';
  if (hasSrcMain && !hasServerJs && !hasIndexJs && !hasAppJs) return 'react';

  // Frontend with explicit build + no server
  if (scripts.build && !scripts.start?.includes('node') && !hasServerJs && !hasIndexJs) return 'react';
  if (scripts.build && scripts.dev && !scripts.start) return 'react';

  // ── Pure Backend / Node ────────────────────────────────────────────────────
  if (hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify') || hasDep(rootPkg, 'koa') || hasDep(rootPkg, 'hapi')) return 'node';
  if (hasDep(rootPkg, '@prisma/client') || hasDep(rootPkg, 'sequelize') || hasDep(rootPkg, 'mongoose')) return 'node';
  if (hasServerJs || hasAppJs) return 'node';
  if (hasIndexJs) return 'node';
  if (scripts.start) return 'node';

  // ── Static fallback ────────────────────────────────────────────────────────
  if (hasIndexHtml) return 'static';
  return 'static';
};

// ─── Nginx SPA Config ─────────────────────────────────────────────────────────
const nginxConf = (port = 3000) => `
server {
    listen ${port};
    root /usr/share/nginx/html;
    index index.html;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml text/javascript image/svg+xml;
    gzip_comp_level 6;
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
    location / {
        try_files \\$uri \\$uri/ /index.html;
    }
}`.trim();

// ─── Dockerfile Generation ────────────────────────────────────────────────────
const generateDockerfile = (stack, repoPath = '') => {

  // ── Determine runtime commands ─────────────────────────────────────────────
  const getCmd = (dir) => {
    const start = getStartCommand(dir);
    if (start.useNpm) return `CMD ["npm", "start"]`;
    return `CMD ["node", "${start.args[0]}"]`;
  };

  // ── Build arg injection block (for all env vars) ───────────────────────────
  const buildArgBlock = `\
ARG VITE_API_URL=""
ARG REACT_APP_API_URL=""
ARG PUBLIC_URL=""
ENV VITE_API_URL=$VITE_API_URL
ENV REACT_APP_API_URL=$REACT_APP_API_URL
ENV PUBLIC_URL=$PUBLIC_URL`;

  // ── Detect frontend build output dir ──────────────────────────────────────
  const getBuildDir = (feDir) => {
    const fullPath = repoPath ? path.join(repoPath, feDir) : feDir;
    return getBuildOutput(fullPath);
  };

  switch (stack) {

    // ─────────────────────────────────────────────────────────────────────────
    // React / Vue / Angular / Svelte / Vite → Build → Serve with Nginx
    // ─────────────────────────────────────────────────────────────────────────
    case 'react': {
      const outDir = repoPath ? getBuildOutput(repoPath) : 'dist';
      return `# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies first (better layer caching)
COPY package*.json ./
RUN npm install --legacy-peer-deps 2>/dev/null || npm install

# Copy source
COPY . .

# Inject environment variables at build time
${buildArgBlock}
ENV NODE_ENV=production

# Build (output to dist/ or build/ depending on framework)
RUN npm run build

# ── Stage 2: Serve ──────────────────────────────────────────────────────────
FROM nginx:alpine
RUN rm -f /etc/nginx/conf.d/default.conf
RUN printf '${nginxConf(3000)}' > /etc/nginx/conf.d/default.conf

# Copy built files (supports both dist/ and build/)
COPY --from=builder /app/${outDir} /usr/share/nginx/html 2>/dev/null || true
RUN cp -r /app/${outDir === 'dist' ? 'build' : 'dist'} /usr/share/nginx/html 2>/dev/null || true

EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Next.js → SSR
    // ─────────────────────────────────────────────────────────────────────────
    case 'next':
      return `# ── Stage 1: Build ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps 2>/dev/null || npm install
COPY . .
${buildArgBlock}
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ── Stage 2: Run ─────────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
# Copy only what's needed to run
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/next.config.* ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3000
CMD ["npm", "start"]
`;

    // ─────────────────────────────────────────────────────────────────────────
    // Nuxt.js
    // ─────────────────────────────────────────────────────────────────────────
    case 'nuxt':
      return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install --legacy-peer-deps 2>/dev/null || npm install
COPY . .
ENV NODE_ENV=production
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
`;

    // ─────────────────────────────────────────────────────────────────────────
    // Static HTML
    // ─────────────────────────────────────────────────────────────────────────
    case 'static':
      return `FROM nginx:alpine
RUN rm -f /etc/nginx/conf.d/default.conf
RUN printf '${nginxConf(3000)}' > /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
# Remove non-web files from nginx root
RUN rm -f /usr/share/nginx/html/Dockerfile /usr/share/nginx/html/*.json /usr/share/nginx/html/.gitignore 2>/dev/null || true
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
`;

    // ─────────────────────────────────────────────────────────────────────────
    // Full-Stack Split: frontend/ + backend/ or client/ + server/
    // ─────────────────────────────────────────────────────────────────────────
    case 'fullstack-split': {
      if (!repoPath) {
        // Fallback if repoPath not provided
        return generateDockerfile('node');
      }
      const feDir   = exists(repoPath, 'frontend') ? 'frontend' : 'client';
      const beDir   = exists(repoPath, 'backend')  ? 'backend'  : 'server';
      const beCmd   = getCmd(path.join(repoPath, beDir));
      const outDir  = getBuildDir(feDir);
      const hasBePkg = exists(repoPath, `${beDir}/package.json`);
      const hasFePkg = exists(repoPath, `${feDir}/package.json`);

      // Check if frontend has a build script
      const fePkg = hasFePkg ? readPkg(repoPath, `${feDir}/package.json`) : null;
      const hasBuild = fePkg?.scripts?.build;

      return `# ── Stage 1: Build Frontend ─────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder
WORKDIR /app
${hasFePkg ? `COPY ${feDir}/package*.json ./
RUN npm install --legacy-peer-deps 2>/dev/null || npm install` : ''}
COPY ${feDir}/ .
${buildArgBlock}
${hasBuild ? `RUN npm run build` : `# No build script found — copying files as-is`}

# ── Stage 2: Backend (serves API + bundled frontend) ─────────────────────────
FROM node:20-alpine
WORKDIR /app
${hasBePkg ? `COPY ${beDir}/package*.json ./
RUN npm install --only=production --legacy-peer-deps 2>/dev/null || npm install --only=production` : ''}
COPY ${beDir}/ .

# Bundle the built frontend into the backend's public directory
RUN mkdir -p ./public
COPY --from=frontend-builder /app/${outDir} ./public/ 2>/dev/null || true
COPY --from=frontend-builder /app/build ./public/ 2>/dev/null || true
COPY --from=frontend-builder /app/out ./public/ 2>/dev/null || true

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
${beCmd}
`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MERN (monorepo with single root package.json)
    // ─────────────────────────────────────────────────────────────────────────
    case 'mern': {
      const clientDir = exists(repoPath || '.', 'client') ? 'client' : 'frontend';
      const outDir    = getBuildDir(clientDir);
      const startCmd  = repoPath ? getCmd(repoPath) : `CMD ["npm", "start"]`;

      return `# ── Stage 1: Build Client ───────────────────────────────────────────────────
FROM node:20-alpine AS client-builder
WORKDIR /app/${clientDir}
COPY ${clientDir}/package*.json ./
RUN npm install --legacy-peer-deps 2>/dev/null || npm install
COPY ${clientDir}/ .
${buildArgBlock}
RUN npm run build

# ── Stage 2: Backend + bundled client ────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps 2>/dev/null || npm install --only=production
COPY . .
# Overwrite with production build
COPY --from=client-builder /app/${clientDir}/${outDir} ./${clientDir}/${outDir}
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
${startCmd}
`;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Pure Node/Express backend
    // ─────────────────────────────────────────────────────────────────────────
    case 'node':
    default: {
      const startCmd = repoPath ? getCmd(repoPath) : `CMD ["npm", "start"]`;
      return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --only=production --legacy-peer-deps 2>/dev/null || npm install --only=production
COPY . .
ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000
${startCmd}
`;
    }
  }
};

module.exports = { detectStack, generateDockerfile, getStartCommand };