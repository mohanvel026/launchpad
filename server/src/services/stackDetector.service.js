const fs   = require('fs');
const path = require('path');

// Detect the project stack by reading package.json and file structure
const detectStack = (repoPath) => {
  const pkgPath = path.join(repoPath, 'package.json');

  // No package.json = pure static site
  if (!fs.existsSync(pkgPath)) {
    const hasHtml = fs.existsSync(path.join(repoPath, 'index.html'));
    return hasHtml ? 'static' : 'unknown';
  }

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const deps = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };
  const scripts = pkg.scripts || {};

  const hasReact   = 'react' in deps;
  const hasVite    = 'vite' in deps;
  const hasExpress = 'express' in deps;
  const hasMongoose = 'mongoose' in deps;
  const hasServer  = fs.existsSync(path.join(repoPath, 'server.js')) ||
                     fs.existsSync(path.join(repoPath, 'index.js')) ||
                     fs.existsSync(path.join(repoPath, 'app.js'));
  const hasClientDir = fs.existsSync(path.join(repoPath, 'client'));

  if (hasExpress && hasMongoose && (hasClientDir || hasReact)) return 'mern';
  if (hasExpress && hasServer) return 'node';
  if (hasReact || hasVite)     return 'react';
  if (hasServer)               return 'node';
  return 'static';
};

// Generate the Dockerfile content based on detected stack
const generateDockerfile = (stack, repoPath) => {
  switch (stack) {
    case 'react':
    case 'static':
      return `FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --silent
COPY . .
RUN npm run build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=builder /app/build /usr/share/nginx/html 2>/dev/null || true
EXPOSE 3000
CMD ["nginx", "-g", "daemon off;"]
`;

    case 'node':
      return `FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --silent
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
`;

    case 'mern':
      return `FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci --silent
COPY client/ .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production --silent
COPY . .
COPY --from=client-builder /app/client/dist ./client/dist
EXPOSE 3000
CMD ["node", "server.js"]
`;

    default:
      return `FROM node:20-alpine
WORKDIR /app
COPY . .
RUN npm install --silent 2>/dev/null || true
EXPOSE 3000
CMD ["node", "server.js"]
`;
  }
};

module.exports = { detectStack, generateDockerfile };