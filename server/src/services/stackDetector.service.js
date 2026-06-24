const fs = require('fs');
const path = require('path');

// ─── Core Helpers ─────────────────────────────────────────────────────────────
const exists = (base, f) => {
  if (!base || typeof base !== 'string' || !f) return false;
  try { return fs.existsSync(path.join(base, f)); } catch { return false; }
};
const readPkg = (base, f = 'package.json') => {
  if (!base || typeof base !== 'string') return null;
  try { return JSON.parse(fs.readFileSync(path.join(base, f), 'utf-8')); }
  catch { return null; }
};
const allDeps = (pkg) => ({ ...((pkg && pkg.dependencies) || {}), ...((pkg && pkg.devDependencies) || {}) });
const hasDep = (pkg, dep) => pkg ? dep in allDeps(pkg) : false;
const getHtmlFiles = (dir) => {
  if (!dir || typeof dir !== 'string') return [];
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
  if (!dir || typeof dir !== 'string') return { name: 'npm', install: 'npm install --no-audit --no-fund --loglevel error', run: 'npm run', lockfile: 'package-lock.json' };
  if (exists(dir, 'pnpm-lock.yaml')) return { name: 'pnpm', install: 'pnpm install --no-audit --no-fund', run: 'pnpm run', lockfile: 'pnpm-lock.yaml' };
  if (exists(dir, 'yarn.lock')) return { name: 'yarn', install: 'yarn install --no-audit --no-fund --prefer-offline', run: 'yarn', lockfile: 'yarn.lock' };
  if (exists(dir, 'bun.lockb')) return { name: 'bun', install: 'bun install --no-audit --no-fund', run: 'bun run', lockfile: 'bun.lockb' };
  return { name: 'npm', install: 'npm ci --legacy-peer-deps --no-audit --no-fund --loglevel error || npm install --legacy-peer-deps --no-audit --no-fund --loglevel error || npm install --no-audit --no-fund --loglevel error', run: 'npm run', lockfile: 'package-lock.json' };
};

const getStartCommand = (dir, pmName = 'npm') => {
  if (!dir || typeof dir !== 'string') return { cmd: 'npm', args: ['start'], isScript: true };
  const pkg = readPkg(dir);
  const runner = pmName === 'npm' ? 'npm' : pmName;

  // 1. Try to parse pkg.scripts.start to see if it directly executes a node/nodemon/pm2 script
  if (pkg && pkg.scripts && pkg.scripts.start) {
    const startScript = pkg.scripts.start;
    const match = startScript.match(/(?:node|pm2-runtime|nodemon)\s+([a-zA-Z0-9_\-\./]+\.js)/);
    if (match && match[1]) {
      return { cmd: 'node', args: [match[1]], isScript: false };
    }
  }

  // 2. Try to use package.json main if it points to a JS file
  if (pkg && pkg.main && pkg.main.endsWith('.js')) {
    return { cmd: 'node', args: [pkg.main], isScript: false };
  }

  // 3. Fallback candidates on filesystem
  const candidates = ['server.js', 'index.js', 'app.js', 'main.js', 'src/server.js', 'src/index.js'];
  for (const f of candidates) {
    if (exists(dir, f)) return { cmd: 'node', args: [f], isScript: false };
  }

  // 4. Fallback to pm start script
  if (pkg && pkg.scripts && pkg.scripts.start) {
    return { cmd: runner, args: ['start'], isScript: true };
  }
  return { cmd: runner, args: ['start'], isScript: true };
};

const getBuildOutput = (dir) => {
  if (!dir || typeof dir !== 'string') return 'dist';
  const pkg = readPkg(dir);
  if (!pkg) return 'dist'; // Fallback for pure static sites without package.json

  const buildScript = (pkg && pkg.scripts && pkg.scripts.build) || '';
  
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
const detectStack = (repoPath) => {
  if (!repoPath || typeof repoPath !== 'string') return 'unknown';
  const rootPkg = readPkg(repoPath);

  const hasFrontendDir = exists(repoPath, 'frontend') || exists(repoPath, 'client');
  const hasBackendDir  = exists(repoPath, 'backend')  || exists(repoPath, 'server');
  const hasHtmlFile    = getHtmlFiles(repoPath).length > 0;

  // ── Non-Node backend language detection (prioritized) ───────────────────
  // Go
  if (exists(repoPath, 'go.mod')) return 'go';
  // Rust
  if (exists(repoPath, 'Cargo.toml')) return 'rust';
  // Java / Kotlin (Spring Boot)
  if (exists(repoPath, 'pom.xml') || exists(repoPath, 'build.gradle') || exists(repoPath, 'build.gradle.kts'))
    return 'java';
  // Ruby
  if (exists(repoPath, 'Gemfile')) return 'ruby';
  // Python
  if (exists(repoPath, 'requirements.txt') || exists(repoPath, 'Pipfile') || exists(repoPath, 'pyproject.toml'))
    return 'python';
  // PHP
  if (exists(repoPath, 'composer.json') || exists(repoPath, 'artisan')) return 'php';
  // .NET (C#)
  const hasDotnet = (() => {
    try {
      return fs.readdirSync(repoPath).some(f => f.endsWith('.sln') || f.endsWith('.csproj'));
    } catch { return false; }
  })();
  if (hasDotnet) return 'dotnet';
  if (!rootPkg) {
    if (hasFrontendDir && hasBackendDir) return 'fullstack-split';
    if (hasFrontendDir) return 'react';
    if (hasBackendDir) return 'node';
    return 'static';
  }

  // ── Node.js framework detection ───────────────────────────────────────────
  const scripts = rootPkg.scripts || {};
  if (hasDep(rootPkg, 'next'))   return 'next';
  if (hasDep(rootPkg, 'nuxt'))   return 'nuxt';
  if (hasDep(rootPkg, 'astro'))  return 'astro';
  if (hasDep(rootPkg, '@sveltejs/kit') || hasDep(rootPkg, 'svelte')) return 'svelte';
  if (hasDep(rootPkg, 'vue'))    return 'vue';
  if (hasDep(rootPkg, '@angular/core')) return 'angular';

  if (hasFrontendDir && hasBackendDir) return 'fullstack-split';

  if ((hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify')) &&
      (hasDep(rootPkg, 'react') || hasFrontendDir)) return 'mern';

  if (hasDep(rootPkg, 'react') || hasDep(rootPkg, 'vue') || hasDep(rootPkg, 'svelte') ||
      hasDep(rootPkg, 'astro') || hasDep(rootPkg, 'angular') || hasDep(rootPkg, 'vite') || scripts.build)
    return 'react';

  if (hasDep(rootPkg, 'express') || hasDep(rootPkg, 'fastify') || scripts.start) return 'node';

  return hasHtmlFile ? 'static' : 'node';
};

// ─── Universal Code Generation Step Detector ─────────────────────────────────
// Scans package.json for ALL tools requiring a pre-build generation step.
// side: 'frontend' | 'backend' | 'both'
// Returns a newline-separated string of RUN commands to inject into Dockerfile.
const detectCodeGenSteps = (pkgDir, prismaSchemaPrefix = '', side = 'both') => {
  const pkg = readPkg(pkgDir);
  if (!pkg) return '';

  const steps = [];
  const isBE = side === 'backend' || side === 'both';
  const isFE = side === 'frontend' || side === 'both';

  // ─── BACKEND TOOLS ─────────────────────────────────────────────────────────

  if (isBE) {
    // 1. Prisma ORM — must generate typed DB client before server starts
    if (hasDep(pkg, 'prisma') || hasDep(pkg, '@prisma/client')) {
      if (prismaSchemaPrefix) steps.push(`COPY ${prismaSchemaPrefix}prisma* ./prisma/`);
      steps.push('RUN DATABASE_URL="mysql://localhost:3306/db" npx prisma generate || true');
    }

    // 2. Drizzle ORM — generates schema types
    if (hasDep(pkg, 'drizzle-kit') || hasDep(pkg, 'drizzle-orm')) {
      steps.push('RUN npx drizzle-kit generate || true');
    }

    // 3. NestJS — compiles TypeScript source
    if (hasDep(pkg, '@nestjs/core') || hasDep(pkg, '@nestjs/cli')) {
      const scripts = pkg.scripts || {};
      if (!scripts.build) steps.push('RUN npx nest build || true');
    }

    // 4. gRPC / Protobuf — generates typed stubs from .proto files
    if (hasDep(pkg, '@grpc/grpc-js') || hasDep(pkg, 'grpc-tools') || hasDep(pkg, '@grpc/proto-loader')) {
      steps.push('RUN find . -name "*.proto" | head -1 | xargs -I{} sh -c "npx grpc_tools_node_protoc_ts --js_out=import_style=commonjs,binary:. --grpc_out=grpc_mode=grpc-js:. {} || true" || true');
    }

    // 5. TypeScript (backend — only if no build script handles it)
    if ((hasDep(pkg, 'typescript') || hasDep(pkg, 'ts-node')) && !hasDep(pkg, '@nestjs/core')) {
      const scripts = pkg.scripts || {};
      const hasBuildScript = scripts.build && (
        scripts.build.includes('tsc') || scripts.build.includes('ts-node') || scripts.build.includes('nest build')
      );
      if (!hasBuildScript) steps.push('RUN npx tsc --skipLibCheck || true');
    }
  }

  // ─── FRONTEND TOOLS ────────────────────────────────────────────────────────

  if (isFE) {
    // 6. GraphQL Code Generator — typed hooks/resolvers from schema (used on both FE & BE)
    if (hasDep(pkg, '@graphql-codegen/cli') || hasDep(pkg, 'graphql-codegen')) {
      steps.push('RUN npx graphql-codegen --config codegen.yml || npx graphql-codegen --config codegen.ts || true');
    }

    // 7. Apollo Client Codegen — generates typed queries from GraphQL schema
    if (hasDep(pkg, '@apollo/codegen') || hasDep(pkg, 'apollo')) {
      steps.push('RUN npx apollo client:codegen --target typescript || true');
    }

    // 8. Orval — generates typed API client from OpenAPI/Swagger spec
    if (hasDep(pkg, 'orval')) {
      steps.push('RUN npx orval || true');
    }

    // 9. swagger-typescript-api — generates typed client from Swagger/OpenAPI
    if (hasDep(pkg, 'swagger-typescript-api')) {
      steps.push('RUN npx swagger-typescript-api || true');
    }

    // 10. OpenAPI Generator CLI — generates full typed API client
    if (hasDep(pkg, '@openapitools/openapi-generator-cli')) {
      steps.push('RUN npx openapi-generator-cli generate || true');
    }

    // 11. Lingui (i18n) — extracts & compiles translation strings
    if (hasDep(pkg, '@lingui/cli') || hasDep(pkg, '@lingui/core')) {
      steps.push('RUN npx lingui extract || true && npx lingui compile || true');
    }

    // 12. i18next-scanner — scans code and extracts translation keys
    if (hasDep(pkg, 'i18next-scanner')) {
      steps.push('RUN npx i18next-scanner || true');
    }

    // 13. next-intl / react-i18next — message extraction (if script exists)
    if (hasDep(pkg, 'next-intl') || hasDep(pkg, 'react-i18next')) {
      const scripts = pkg.scripts || {};
      if (scripts['extract'] || scripts['i18n:extract']) {
        steps.push('RUN npm run extract || npm run i18n:extract || true');
      }
    }

    // 14. Tailwind CSS standalone (only if no build script handles it via PostCSS)
    if (hasDep(pkg, 'tailwindcss')) {
      const scripts = pkg.scripts || {};
      const buildHandlesTW = scripts.build && (
        scripts.build.includes('tailwind') || scripts.build.includes('vite') ||
        scripts.build.includes('next') || scripts.build.includes('react-scripts')
      );
      if (!buildHandlesTW && scripts['build:css']) {
        steps.push('RUN npm run build:css || true');
      }
    }

    // 15. TypeScript on frontend (only if vite/webpack won't handle it via build)
    if (hasDep(pkg, 'typescript') && !hasDep(pkg, 'vite') && !hasDep(pkg, 'react-scripts') &&
        !hasDep(pkg, 'next') && !hasDep(pkg, '@angular/core')) {
      const scripts = pkg.scripts || {};
      const hasBuildScript = scripts.build && scripts.build.includes('tsc');
      if (!hasBuildScript) steps.push('RUN npx tsc --skipLibCheck || true');
    }
  }

  return steps.length > 0 ? '\n' + steps.join('\n') : '';
};

// ─── Universal Runtime Database Migration Detector ───────────────────────────
// Detects database/ORM migration steps to be executed at startup/runtime instead of build time.
const detectMigrationSteps = (pkgDir) => {
  const pkg = readPkg(pkgDir);
  if (!pkg) return [];

  const steps = [];

  // 1. Prisma
  if (hasDep(pkg, 'prisma') || hasDep(pkg, '@prisma/client')) {
    steps.push('npx prisma migrate deploy || npx prisma db push');
  }

  // 2. Drizzle
  if (hasDep(pkg, 'drizzle-kit') || hasDep(pkg, 'drizzle-orm')) {
    steps.push('npx drizzle-kit migrate || npx drizzle-kit push');
  }

  // 3. TypeORM
  if (hasDep(pkg, 'typeorm')) {
    steps.push('npx typeorm migration:run');
  }

  // 4. Sequelize CLI
  if (hasDep(pkg, 'sequelize-cli') || hasDep(pkg, 'sequelize')) {
    steps.push('npx sequelize-cli db:migrate');
  }

  // 5. MikroORM
  if (hasDep(pkg, '@mikro-orm/core') || hasDep(pkg, 'mikro-orm')) {
    steps.push('npx mikro-orm migration:up');
  }

  // 6. Knex.js
  if (hasDep(pkg, 'knex')) {
    steps.push('npx knex migrate:latest');
  }

  return steps;
};


// ─── Dockerfile Generation ────────────────────────────────────────────────────
const generateDockerfile = (stack, repoPath = '', options = {}) => {
  // If stack is passed as string use it, otherwise detect it.
  const type = (stack && typeof stack === 'string') ? stack : detectStack(repoPath);
  
  // Detect package manager directly here instead of relying on detectStack
  const pm = detectPackageManager(repoPath);

  // Detect node version from package.json engines field (default to 20)
  let nodeVersion = '20';
  if (repoPath) {
    try {
      const rootPkg = readPkg(repoPath);
      let enginesNode = rootPkg.engines?.node;
      
      if (!enginesNode) {
        const subDirs = ['server', 'backend', 'client', 'frontend'];
        for (const dir of subDirs) {
          if (exists(repoPath, dir)) {
            try {
              const subPkg = readPkg(path.join(repoPath, dir));
              if (subPkg.engines?.node) {
                enginesNode = subPkg.engines.node;
                break;
              }
            } catch (e) {}
          }
        }
      }

      if (enginesNode) {
        const match = enginesNode.match(/(\d+)/);
        if (match) {
          const v = parseInt(match[1]);
          if ([16, 18, 20, 22].includes(v)) {
            nodeVersion = String(v);
          }
        }
      }
    } catch (e) {}
  }

  const chmodHelper = 'RUN find . -name "*.sh" -exec chmod +x {} + 2>/dev/null || true\nRUN chmod +x node_modules/.bin/* 2>/dev/null || true\n';

  const containerPort = options.containerPort || 3000;

  // SRE: Detect if Prisma ORM is present to install runtime OS packages (openssl, libc6-compat) in Alpine
  const hasPrisma = (() => {
    if (!repoPath) return false;
    try {
      const rootPkg = readPkg(repoPath);
      if (hasDep(rootPkg, 'prisma') || hasDep(rootPkg, '@prisma/client')) return true;
    } catch (e) {}
    try {
      const beDir = exists(repoPath, 'server') ? 'server' : (exists(repoPath, 'backend') ? 'backend' : '');
      if (beDir) {
        const bePkg = readPkg(path.join(repoPath, beDir));
        if (hasDep(bePkg, 'prisma') || hasDep(bePkg, '@prisma/client')) return true;
      }
    } catch (e) {}
    try {
      const feDir = exists(repoPath, 'client') ? 'client' : (exists(repoPath, 'frontend') ? 'frontend' : '');
      if (feDir) {
        const fePkg = readPkg(path.join(repoPath, feDir));
        if (hasDep(fePkg, 'prisma') || hasDep(fePkg, '@prisma/client')) return true;
      }
    } catch (e) {}
    return false;
  })();

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
    .map(e => e.isSecret
      ? `ARG ${e.key}=""
ENV ${e.key}=$${e.key}`
      : `ARG ${e.key}=""
ENV ${e.key}=$${e.key}`)
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

    // LaunchLive fallback landing page shown when the repo has no HTML files
    const fallbackHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome to LaunchLive</title>
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
        <h1>Your Site is Live on LaunchLive!</h1>
        <p>Your container deployed successfully. Add an <code>index.html</code> to your repo and redeploy to publish your content.</p>
        <div class="instructions">
            <h3>How to publish your content:</h3>
            <p style="font-size:0.95rem;margin-bottom:0">Add an <code>index.html</code> file to the root of your repository and trigger a redeploy from your LaunchLive dashboard.</p>
        </div>
        <div class="footer">Powered by LaunchLive Serverless Containers</div>
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
      const feCodeGenSteps = detectCodeGenSteps(repoPath, '', 'frontend');
      return `FROM node:${nodeVersion}-alpine AS builder
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=512"
${pmSetup}
COPY package*.json ${lockFile} ./
${installRunInstruction}
COPY . .
${chmodHelper}${envArgs}${feCodeGenSteps}
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
      const feCodeGenSteps = detectCodeGenSteps(repoPath, '', 'frontend');
      const migrations = detectMigrationSteps(repoPath);
      let runCmd = `CMD ["${pm.name}", "start"]`;
      if (migrations.length > 0) {
        const migrationCmds = migrations.map(m => `${m} || true`).join(' && ');
        runCmd = `CMD ["sh", "-c", "${migrationCmds} && ${pm.name} start"]`;
      }
      return `FROM node:${nodeVersion}-alpine AS builder
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=512"
${pmSetup}
COPY package*.json ${lockFile} ./
${installRunInstruction}
COPY . .
${chmodHelper}${envArgs}${feCodeGenSteps}
RUN --mount=type=cache,target=/app/.next/cache ${buildCmd}

FROM node:${nodeVersion}-alpine
RUN apk add --no-cache curl tini ca-certificates${hasPrisma ? ' openssl libc6-compat' : ''}
WORKDIR /app
ENV PORT=${containerPort}
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
${runCmd}`;
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
      const feLockStr = feLock ? ` ${feLock}` : '';

      const bePath = path.join(repoPath, beDir);

      const bePkg = readPkg(path.join(repoPath, beDir));
      const codeGenSteps = detectCodeGenSteps(path.join(repoPath, beDir), `${beDir}/`, 'backend');
      const feCodeGenSteps = detectCodeGenSteps(path.join(repoPath, feDir), '', 'frontend');
      const beMigrations = detectMigrationSteps(path.join(repoPath, beDir));

      const migrationRunStr = beMigrations.length > 0
        ? beMigrations.map(m => `${m} || true`).join('\\n') + '\\n'
        : '';

      // Detect backend stack dynamically
      let beStack = 'node';
      if (exists(bePath, 'go.mod')) beStack = 'go';
      else if (exists(bePath, 'Cargo.toml')) beStack = 'rust';
      else if (exists(bePath, 'pom.xml') || exists(bePath, 'build.gradle') || exists(bePath, 'build.gradle.kts')) beStack = 'java';
      else if (exists(bePath, 'Gemfile')) beStack = 'ruby';
      else if (exists(bePath, 'requirements.txt') || exists(bePath, 'Pipfile') || exists(bePath, 'pyproject.toml')) beStack = 'python';
      else if (exists(bePath, 'composer.json') || exists(bePath, 'artisan')) beStack = 'php';
      else {
        const hasDotnet = (() => {
          try {
            return fs.readdirSync(bePath).some(f => f.endsWith('.sln') || f.endsWith('.csproj'));
          } catch { return false; }
        })();
        if (hasDotnet) beStack = 'dotnet';
      }

      // Stage 1: Build Frontend (Parallel stage)
      const frontendBuilderStage = `# ── Stage 1: Build Frontend (runs in PARALLEL with Stage 2) ──
FROM node:${nodeVersion}-alpine AS fe-builder
WORKDIR /app/frontend
ENV NODE_OPTIONS="--max-old-space-size=512"
${pmSetup}
COPY ${feDir}/package*.json${feLockStr} ./
${installRunInstruction}
COPY ${feDir}/ .
${chmodHelper}${envArgs}${feCodeGenSteps}
RUN ${buildCmd} || npx vite build`;

      if (beStack === 'go') {
        const hasProto = (() => { try { return fs.readdirSync(bePath).some(f => f.endsWith('.proto')); } catch { return false; } })();
        const protoStep = hasProto
          ? `\nRUN apt-get install -y protobuf-compiler && go install google.golang.org/protoc-gen-go@latest && protoc --go_out=. --go-grpc_out=. *.proto || true`
          : '';
        return `${frontendBuilderStage}

# ── Stage 2: Build Go Backend ──
FROM golang:1.22-alpine AS be-builder
RUN apk add --no-cache git curl${hasProto ? ' protoc' : ''}
WORKDIR /app
COPY ${beDir}/go.mod ${exists(bePath, 'go.sum') ? beDir + '/go.sum' : ''} ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY ${beDir}/ .${protoStep}
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    go generate ./... || true
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

# ── Stage 3: Final Stage ──
FROM alpine:3.19
RUN apk add --no-cache curl nginx tini ca-certificates
WORKDIR /app
COPY --from=be-builder /app/server .
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
${nginxHeredocBlock(true)}
ENV PORT=4000
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\nPORT=4000 ./server &\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
      }

      if (beStack === 'rust') {
        return `${frontendBuilderStage}

# ── Stage 2: Build Rust Backend ──
FROM rust:1.77-slim AS be-builder
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ${beDir}/Cargo.toml ${exists(bePath, 'Cargo.lock') ? beDir + '/Cargo.lock' : ''} ./
RUN --mount=type=cache,target=/usr/local/cargo/registry \\
    --mount=type=cache,target=/app/target \\
    mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY ${beDir}/src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \\
    --mount=type=cache,target=/app/target \\
    touch src/main.rs && cargo build --release && \\
    (cp target/release/$(ls target/release | grep -v '\\.' | head -1) ./server 2>/dev/null || cp target/release/* ./server 2>/dev/null)

# ── Stage 3: Final Stage ──
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 curl ca-certificates nginx tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=be-builder /app/server ./server
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
${nginxHeredocBlock(true)}
ENV PORT=4000
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\nPORT=4000 ./server &\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
      }

      if (beStack === 'python') {
        const hasDjango  = exists(bePath, 'manage.py');
        const reqFile    = exists(bePath, 'requirements.txt') ? 'requirements.txt'
                         : exists(bePath, 'Pipfile')          ? 'Pipfile'
                         : 'requirements.txt';
        const pyEntry = ['main.py','app.py','wsgi.py','asgi.py','run.py'].find(f => exists(bePath, f)) || 'main.py';
        
        const hasFlaskMigrate = exists(bePath, 'migrations') && (() => {
          try {
            const req = fs.readFileSync(path.join(bePath, 'requirements.txt'), 'utf8').toLowerCase();
            return req.includes('flask-migrate') || req.includes('flask_migrate');
          } catch { return false; }
        })();

        const hasAlembic = exists(bePath, 'alembic.ini') || (() => {
          try {
            const req = fs.readFileSync(path.join(bePath, 'requirements.txt'), 'utf8').toLowerCase();
            return req.includes('alembic');
          } catch { return false; }
        })();

        const migrationCmds = [];
        if (hasDjango) migrationCmds.push('python manage.py migrate --no-input');
        else if (hasFlaskMigrate) migrationCmds.push('flask db upgrade');
        else if (hasAlembic) migrationCmds.push('alembic upgrade head');

        const runMigration = migrationCmds.map(m => `${m} || true`).join(' && ');
        const migrationRunStr = runMigration ? `${runMigration} && ` : '';
        const baseStart = hasDjango
          ? `gunicorn --bind 0.0.0.0:4000 --workers 2 wsgi:application`
          : `uvicorn ${pyEntry.replace('.py','')}:app --host 0.0.0.0 --port 4000`;

        const pyInstall = reqFile === 'Pipfile'
          ? 'RUN --mount=type=cache,target=/root/.cache/pip --mount=type=cache,target=/root/.cache/pipenv pip install pipenv && pipenv install --system --deploy'
          : 'RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt';

        return `${frontendBuilderStage}

# ── Stage 2: Final Stage ──
FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends nginx curl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ${beDir}/${reqFile} ./
${pyInstall}
COPY ${beDir}/ .
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
${nginxHeredocBlock(true)}
ENV PORT=4000
ENV PYTHONUNBUFFERED=1
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\n${migrationRunStr}PORT=4000 ${baseStart} &\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
      }

      if (beStack === 'ruby') {
        const hasRails = exists(bePath, 'config/routes.rb') || exists(bePath, 'Gemfile') &&
          (() => { try { return fs.readFileSync(path.join(bePath, 'Gemfile'), 'utf8').includes('rails'); } catch { return false; } })();
        const hasRakefile = exists(bePath, 'Rakefile');
        
        const rubyMigrate = hasRails ? 'bundle exec rails db:migrate RAILS_ENV=production'
                          : hasRakefile ? 'bundle exec rake db:migrate'
                          : '';
        const runMigration = rubyMigrate ? `${rubyMigrate} || true && ` : '';

        return `${frontendBuilderStage}

# ── Stage 2: Final Stage ──
FROM ruby:3.3-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev curl nodejs nginx tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ${beDir}/Gemfile ${exists(bePath, 'Gemfile.lock') ? beDir + '/Gemfile.lock' : ''} ./
RUN --mount=type=cache,target=/usr/local/bundle \\
    bundle install --without development test --jobs 4 --retry 3
COPY ${beDir}/ .
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
${nginxHeredocBlock(true)}
ENV PORT=4000
ENV RAILS_ENV=production
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\n${runMigration}PORT=4000 bundle exec ${hasRails ? "rails server -b 0.0.0.0 -p 4000" : "ruby app.rb"} &\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
      }

      if (beStack === 'java') {
        const hasMaven  = exists(bePath, 'pom.xml');
        const hasGradle = exists(bePath, 'build.gradle') || exists(bePath, 'build.gradle.kts');
        const buildSetup = hasMaven
          ? 'RUN apt-get update && apt-get install -y --no-install-recommends maven && rm -rf /var/lib/apt/lists/*'
          : 'RUN chmod +x gradlew';
        const buildCmd = hasMaven
          ? 'RUN --mount=type=cache,target=/root/.m2 mvn package -DskipTests --no-transfer-progress && cp target/*.jar app.jar'
          : 'RUN --mount=type=cache,target=/root/.gradle ./gradlew bootJar -x test && cp build/libs/*.jar app.jar';

        return `${frontendBuilderStage}

# ── Stage 2: Build Java Backend ──
FROM eclipse-temurin:21-jdk-alpine AS be-builder
RUN apk add --no-cache curl
WORKDIR /app
${buildSetup}
COPY ${beDir}/ .
${buildCmd}

# ── Stage 3: Final Stage ──
FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl nginx tini
WORKDIR /app
COPY --from=be-builder /app/app.jar app.jar
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
${nginxHeredocBlock(true)}
ENV SERVER_PORT=4000
ENV PORT=4000
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\njava -jar app.jar --server.port=4000 &\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
      }

      if (beStack === 'php') {
        const hasArtisan = exists(bePath, 'artisan');
        const phpInstall = 'RUN --mount=type=cache,target=/root/.composer/cache composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader';
        const migrationCmd = hasArtisan ? 'php artisan migrate --force || true && ' : '';

        const phpNginxConf = `server {
    listen ${containerPort};
    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        root /app/public;
        rewrite ^/api/(.*)$ /$1 break;
        try_files $uri $uri/ /index.php?$query_string;

        location ~ \\.php$ {
            fastcgi_pass 127.0.0.1:9000;
            fastcgi_index index.php;
            include fastcgi_params;
            fastcgi_param SCRIPT_FILENAME /app/public/index.php;
        }
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}`;
        const b64Nginx = Buffer.from(phpNginxConf).toString('base64');
        const configDir = '/etc/nginx/http.d';

        return `${frontendBuilderStage}

# ── Stage 2: Final Stage ──
FROM php:8.2-fpm-alpine
RUN apk add --no-cache curl nginx tini shadow libpng-dev libjpeg-turbo-dev freetype-dev zip libzip-dev git
RUN docker-php-ext-configure gd --with-freetype --with-jpeg && docker-php-ext-install gd zip pdo pdo_mysql bcmath
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY ${beDir}/composer.json ${exists(bePath, 'composer.lock') ? beDir + '/composer.lock' : ''} ./
${phpInstall}
COPY ${beDir}/ .
RUN composer run-script post-autoload-dump || true
RUN mkdir -p ${configDir} && printf '%s' '${b64Nginx}' | base64 -d > ${configDir}/default.conf
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
ENV PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\n${migrationCmd}php-fpm -D\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
      }

      if (beStack === 'dotnet') {
        const files = fs.readdirSync(bePath);
        const csproj = files.find(f => f.endsWith('.csproj')) || 'app.csproj';
        const appName = csproj.replace('.csproj', '');

        return `${frontendBuilderStage}

# ── Stage 2: Build .NET Backend ──
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS be-builder
WORKDIR /app
COPY ${beDir}/*.csproj ./
RUN --mount=type=cache,target=/root/.nuget/packages dotnet restore
COPY ${beDir}/ .
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish -c Release -o out

# ── Stage 3: Final Stage ──
FROM mcr.microsoft.com/dotnet/aspnet:8.0
RUN apt-get update && apt-get install -y --no-install-recommends curl nginx tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=be-builder /app/out .
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
${nginxHeredocBlock(true)}
ENV ASPNETCORE_URLS=http://+:4000
ENV PORT=4000
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\ndotnet ${appName}.dll &\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
      }

      // Default Node backend stage
      const bePm = detectPackageManager(bePath);
      const beLock = exists(bePath, bePm.lockfile) ? `${beDir}/${bePm.lockfile}` : '';
      const beLockStr = beLock ? ` ${beLock}` : '';

      const start = getStartCommand(bePath, bePm.name);
      const backendCmd = start.isScript
        ? `pm2-runtime start ${bePm.name} --name backend -- start`
        : `pm2-runtime start ${start.args[0]} --name backend`;

      const beCacheMount = bePm.name === 'npm' ? '--mount=type=cache,target=/root/.npm' :
                           bePm.name === 'pnpm' ? '--mount=type=cache,target=/root/.local/share/pnpm/store' :
                           bePm.name === 'yarn' ? '--mount=type=cache,target=/root/.yarn' :
                           bePm.name === 'bun' ? '--mount=type=cache,target=/root/.bun' : '';

      let bePmSetup = '';
      if (bePm.name === 'yarn') bePmSetup = 'RUN corepack enable && corepack prepare yarn@stable --activate';
      if (bePm.name === 'pnpm') bePmSetup = 'RUN corepack enable && corepack prepare pnpm@latest --activate';
      if (bePm.name === 'bun')  bePmSetup = 'RUN npm install -g bun';

      let beInstallAllCmd = `RUN ${beCacheMount} ${bePm.install}`;
      if (bePm.name === 'npm') {
        beInstallAllCmd = `RUN ${beCacheMount} npm install --legacy-peer-deps --no-audit --no-fund --loglevel error 2>/dev/null || npm install --no-audit --no-fund --loglevel error`;
      }

      const beBuildStep = (bePkg && bePkg.scripts && bePkg.scripts.build)
        ? `RUN ${bePm.run} build || true\n`
        : '';

      let bePruneCmd = 'npm prune --production --no-audit --no-fund --loglevel error';
      if (bePm.name === 'pnpm') {
        bePruneCmd = 'pnpm prune --prod';
      } else if (bePm.name === 'yarn') {
        bePruneCmd = 'yarn install --production --ignore-scripts --prefer-offline --no-audit --no-fund 2>/dev/null || yarn install --production';
      } else if (bePm.name === 'bun') {
        bePruneCmd = 'bun install --production';
      }
      const bePruneStep = `RUN ${bePruneCmd} || true\n`;

      return `${frontendBuilderStage}

# ── Stage 2: Install & Build Backend (runs in PARALLEL with Stage 1) ──
FROM node:${nodeVersion}-alpine AS be-builder
WORKDIR /app
# SRE Optimization: Force sequential execution under memory limits by copying from fe-builder stage
COPY --from=fe-builder /app/frontend/package*.json /tmp/dummy-fe-pkg.json
${bePmSetup}
COPY ${beDir}/package*.json${beLockStr} ./
${beInstallAllCmd}
COPY ${beDir}/ .${codeGenSteps}
${chmodHelper}${beBuildStep}${bePruneStep}
# ── Stage 3: Final SRE container ──
FROM node:${nodeVersion}-alpine
RUN apk add --no-cache curl nginx tini ca-certificates${hasPrisma ? ' openssl libc6-compat' : ''}
RUN npm install -g pm2 --silent

WORKDIR /app
COPY --from=be-builder /app ./
COPY --from=fe-builder /app/frontend/${feOut} /usr/share/nginx/html
${nginxHeredocBlock(true)}
ENV PORT=4000
ENV NODE_ENV=production
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\n${migrationRunStr}ln -sf /dev/stdout /var/log/nginx/access.log\\nln -sf /dev/stderr /var/log/nginx/error.log\\nnginx\\n${backendCmd}\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
    }

    case 'nuxt': {
      const lockFile = exists(repoPath, pm.lockfile) ? pm.lockfile : '';
      const feCodeGenSteps = detectCodeGenSteps(repoPath, '', 'frontend');
      const migrations = detectMigrationSteps(repoPath);
      let runCmd = `CMD ["node", ".output/server/index.mjs"]`;
      if (migrations.length > 0) {
        const migrationCmds = migrations.map(m => `${m} || true`).join(' && ');
        runCmd = `CMD ["sh", "-c", "${migrationCmds} && node .output/server/index.mjs"]`;
      }
      return `FROM node:${nodeVersion}-alpine AS builder
WORKDIR /app
ENV NODE_OPTIONS="--max-old-space-size=512"
${pmSetup}
COPY package*.json ${lockFile} ./
${installRunInstruction}
COPY . .
${chmodHelper}${envArgs}${feCodeGenSteps}
RUN ${buildCmd} || npx nuxt build

FROM node:${nodeVersion}-alpine
RUN apk add --no-cache curl tini ca-certificates${hasPrisma ? ' openssl libc6-compat' : ''}
WORKDIR /app
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/package*.json ./
ENV PORT=${containerPort}
ENV NODE_ENV=production
ENV NITRO_PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
${runCmd}`;
   }

    case 'python': {
      const hasDjango  = exists(repoPath, 'manage.py');
      const hasFastAPI = (() => {
        try { return fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8').toLowerCase().includes('fastapi'); } catch { return false; }
      })();
      const hasFlask   = (() => {
        try { return fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8').toLowerCase().includes('flask'); } catch { return false; }
      })();
      const hasFlaskMigrate = exists(repoPath, 'migrations') && (() => {
        try {
          const req = fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8').toLowerCase();
          return req.includes('flask-migrate') || req.includes('flask_migrate');
        } catch { return false; }
      })();
      const hasAlembic = exists(repoPath, 'alembic.ini') || (() => {
        try {
          const req = fs.readFileSync(path.join(repoPath, 'requirements.txt'), 'utf8').toLowerCase();
          return req.includes('alembic');
        } catch { return false; }
      })();
      const reqFile    = exists(repoPath, 'requirements.txt') ? 'requirements.txt'
                       : exists(repoPath, 'Pipfile')          ? 'Pipfile'
                       : 'requirements.txt';

      const pyEntry = ['main.py','app.py','wsgi.py','asgi.py','run.py'].find(f => exists(repoPath, f)) || 'main.py';

      const migrationCmds = [];
      if (hasDjango) migrationCmds.push('python manage.py migrate --no-input');
      else if (hasFlaskMigrate) migrationCmds.push('flask db upgrade');
      else if (hasAlembic) migrationCmds.push('alembic upgrade head');

      const runMigration = migrationCmds.map(m => `${m} || true`).join(' && ');
      const baseStart = hasDjango
        ? `gunicorn --bind 0.0.0.0:${containerPort} --workers 2 wsgi:application`
        : `uvicorn ${pyEntry.replace('.py','')}:app --host 0.0.0.0 --port ${containerPort}`;

      const pyStartCmd = runMigration
        ? `CMD ["sh", "-c", "${runMigration} && ${baseStart}"]`
        : `CMD ["sh", "-c", "${baseStart}"]`;

      const pyInstall = reqFile === 'Pipfile'
        ? 'RUN --mount=type=cache,target=/root/.cache/pip --mount=type=cache,target=/root/.cache/pipenv pip install pipenv && pipenv install --system --deploy'
        : 'RUN --mount=type=cache,target=/root/.cache/pip pip install -r requirements.txt';

      return `FROM python:3.11-slim
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY ${reqFile} ./
${pyInstall}
COPY . .
ENV PORT=${containerPort}
ENV PYTHONUNBUFFERED=1
EXPOSE ${containerPort}
${healthCheck}
${pyStartCmd}`;
    }

    case 'go': {
      const goMod = exists(repoPath, 'go.mod');
      const hasProto = (() => { try { return fs.readdirSync(repoPath).some(f => f.endsWith('.proto')); } catch { return false; } })();
      const protoStep = hasProto
        ? '\nRUN apt-get install -y protobuf-compiler && go install google.golang.org/protoc-gen-go@latest && protoc --go_out=. --go-grpc_out=. *.proto || true'
        : '';
      return `FROM golang:1.22-alpine AS builder
RUN apk add --no-cache git curl${hasProto ? ' protoc' : ''}
WORKDIR /app
COPY go.mod ${exists(repoPath, 'go.sum') ? 'go.sum' : ''} ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .${protoStep}
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    go generate ./... || true
RUN --mount=type=cache,target=/go/pkg/mod \\
    --mount=type=cache,target=/root/.cache/go-build \\
    CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o server .

FROM alpine:3.19
RUN apk add --no-cache curl ca-certificates tini
WORKDIR /app
COPY --from=builder /app/server .
ENV PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["./server"]`;
    }

    case 'rust': {
      return `FROM rust:1.77-slim AS builder
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config libssl-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
RUN --mount=type=cache,target=/usr/local/cargo/registry \\
    --mount=type=cache,target=/app/target \\
    mkdir src && echo 'fn main(){}' > src/main.rs && cargo build --release && rm -rf src
COPY src ./src
RUN --mount=type=cache,target=/usr/local/cargo/registry \\
    --mount=type=cache,target=/app/target \\
    touch src/main.rs && cargo build --release && \\
    (cp target/release/$(ls target/release | grep -v '\\.' | head -1) ./server 2>/dev/null || cp target/release/* ./server 2>/dev/null)

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libssl3 curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/server ./server
ENV PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
CMD ["./server"]`;
    }

    case 'ruby': {
      const hasRails = exists(repoPath, 'config/routes.rb') || exists(repoPath, 'Gemfile') &&
        (() => { try { return fs.readFileSync(path.join(repoPath, 'Gemfile'), 'utf8').includes('rails'); } catch { return false; } })();
      const hasRakefile = exists(repoPath, 'Rakefile');
      
      const rubyMigrate = hasRails ? 'bundle exec rails db:migrate RAILS_ENV=production'
                        : hasRakefile ? 'bundle exec rake db:migrate'
                        : '';
      const runMigration = rubyMigrate ? `${rubyMigrate} || true && ` : '';
      const rubyStart = `CMD ["sh", "-c", "${runMigration}bundle exec ${hasRails ? 'rails server -b 0.0.0.0 -p ' + containerPort : 'ruby app.rb'}"]`;
      return `FROM ruby:3.3-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev curl nodejs && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY Gemfile Gemfile.lock ./
RUN --mount=type=cache,target=/usr/local/bundle \\
    bundle install --without development test --jobs 4 --retry 3
COPY . .
ENV PORT=${containerPort}
ENV RAILS_ENV=production
EXPOSE ${containerPort}
${healthCheck}
${rubyStart}`;
    }

    case 'java': {
      const hasMaven  = exists(repoPath, 'pom.xml');
      const hasGradle = exists(repoPath, 'build.gradle') || exists(repoPath, 'build.gradle.kts');
      const buildSetup = hasMaven
        ? 'RUN apt-get update && apt-get install -y --no-install-recommends maven && rm -rf /var/lib/apt/lists/*'
        : 'RUN chmod +x gradlew';
      const buildCmd = hasMaven
        ? 'RUN --mount=type=cache,target=/root/.m2 mvn package -DskipTests --no-transfer-progress && cp target/*.jar app.jar'
        : 'RUN --mount=type=cache,target=/root/.gradle ./gradlew bootJar -x test && cp build/libs/*.jar app.jar';
      return `FROM eclipse-temurin:21-jdk-alpine AS builder
RUN apk add --no-cache curl
WORKDIR /app
${buildSetup}
COPY . .
${buildCmd}

FROM eclipse-temurin:21-jre-alpine
RUN apk add --no-cache curl tini
WORKDIR /app
COPY --from=builder /app/app.jar app.jar
ENV SERVER_PORT=${containerPort}
ENV PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["java", "-jar", "app.jar", "--server.port=${containerPort}"]`;
    }

    case 'php': {
      const hasArtisan = exists(repoPath, 'artisan');
      const phpInstall = 'RUN --mount=type=cache,target=/root/.composer/cache composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader';
      const migrationCmd = hasArtisan ? 'php artisan migrate --force || true && ' : '';

      const phpNginxConf = `server {
    listen ${containerPort};
    root /app/public;
    index index.php index.html;

    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    location ~ \\.php$ {
        fastcgi_pass 127.0.0.1:9000;
        fastcgi_index index.php;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    }
}`;
      const b64Nginx = Buffer.from(phpNginxConf).toString('base64');
      const configDir = '/etc/nginx/http.d';

      return `FROM php:8.2-fpm-alpine
RUN apk add --no-cache curl nginx tini shadow libpng-dev libjpeg-turbo-dev freetype-dev zip libzip-dev git
RUN docker-php-ext-configure gd --with-freetype --with-jpeg && docker-php-ext-install gd zip pdo pdo_mysql bcmath
COPY --from=composer:latest /usr/bin/composer /usr/bin/composer
WORKDIR /app
COPY composer.json composer.lock* ./
${phpInstall}
COPY . .
RUN composer run-script post-autoload-dump || true
RUN mkdir -p ${configDir} && printf '%s' '${b64Nginx}' | base64 -d > ${configDir}/default.conf
ENV PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
RUN printf '#!/bin/sh\\nset -e\\n${migrationCmd}php-fpm -D\\nnginx -g "daemon off;"\\n' > /app/start.sh && chmod +x /app/start.sh
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["/app/start.sh"]`;
    }

    case 'dotnet': {
      const files = repoPath ? fs.readdirSync(repoPath) : [];
      const csproj = files.find(f => f.endsWith('.csproj')) || 'app.csproj';
      const appName = csproj.replace('.csproj', '');
      return `FROM mcr.microsoft.com/dotnet/sdk:8.0 AS builder
WORKDIR /app
COPY *.sln ./ 2>/dev/null || true
COPY *.csproj ./
RUN --mount=type=cache,target=/root/.nuget/packages dotnet restore
COPY . .
RUN --mount=type=cache,target=/root/.nuget/packages dotnet publish -c Release -o out

FROM mcr.microsoft.com/dotnet/aspnet:8.0
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=builder /app/out .
ENV ASPNETCORE_URLS=http://+:${containerPort}
ENV PORT=${containerPort}
EXPOSE ${containerPort}
${healthCheck}
CMD ["dotnet", "${appName}.dll"]`;
    }

    case 'node':
    default: {
      const rootPkg = readPkg(repoPath);
      const codeGenSteps = detectCodeGenSteps(repoPath, '', 'backend');
      const migrations = detectMigrationSteps(repoPath);

      const start = getStartCommand(repoPath, pm.name);
      const lockFile = exists(repoPath, pm.lockfile) ? pm.lockfile : '';
      const lockFileCopy = lockFile ? `COPY ${lockFile} ./` : '';
      let runCmd = '';
      if (migrations.length > 0) {
        const migrationCmds = migrations.map(m => `${m} || true`).join(' && ');
        const baseCmd = start.isScript ? `${pm.name} start` : `node ${start.args[0]}`;
        runCmd = `CMD ["sh", "-c", "${migrationCmds} && ${baseCmd}"]`;
      } else {
        runCmd = start.isScript ? `CMD ["${pm.name}", "start"]` : `CMD ["node", "${start.args[0]}"]`;
      }

      const buildCmdStep = (rootPkg && rootPkg.scripts && rootPkg.scripts.build)
        ? `RUN ${pm.run} build || true\n`
        : '';

      let pruneCmd = 'npm prune --production';
      if (pm.name === 'pnpm') {
        pruneCmd = 'pnpm prune --prod';
      } else if (pm.name === 'yarn') {
        pruneCmd = 'yarn install --production --ignore-scripts --prefer-offline 2>/dev/null || yarn install --production';
      } else if (pm.name === 'bun') {
        pruneCmd = 'bun install --production';
      }
      const pruneStep = `RUN ${pruneCmd} || true\n`;

      return `FROM node:${nodeVersion}-alpine
RUN apk add --no-cache curl tini ca-certificates${hasPrisma ? ' openssl libc6-compat' : ''}
WORKDIR /app
COPY package*.json ./
${lockFileCopy}
${installRunInstruction}
COPY . .${codeGenSteps}
${chmodHelper}${buildCmdStep}${pruneStep}ENV PORT=${containerPort}
ENV NODE_ENV=production
EXPOSE ${containerPort}
${healthCheck}
ENTRYPOINT ["/sbin/tini", "--"]
${runCmd}`;
    }
  }
};


module.exports = { detectStack, generateDockerfile, getStartCommand, detectPackageManager };