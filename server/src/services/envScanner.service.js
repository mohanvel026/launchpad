const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Ignore lists for directories and files to keep scan fast and relevant
const IGNORE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'out', 
  'coverage', 'public', '.cache', 'tests', '__tests__', '__mocks__'
]);

const IGNORE_FILES = new Set([
  'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml', 'npm-debug.log',
  'tsconfig.json', 'jsconfig.json', '.gitignore', '.eslintignore', 
  '.prettierrc', '.dockerignore', 'Dockerfile', 'README.md', 'LICENSE'
]);

// Database / Cache drivers package names in different languages
const DB_DRIVERS = {
  mongodb: [
    // Node
    'mongoose', 'mongodb', 'mongodb-legacy', 
    // Python
    'pymongo', 'motor', 'mongoengine', 'djongo', 
    // Go
    'go.mongodb.org/mongo-driver', 
    // Ruby
    'mongo', 'mongoid'
  ],
  sql: [
    // Node
    'pg', 'mysql2', 'mysql', 'sqlite3', 'sqlite', 'sequelize', 'prisma', 
    '@prisma/client', 'typeorm', 'knex', 'mariadb', 'tedious', 'mssql',
    // Python
    'psycopg2', 'psycopg2-binary', 'pymysql', 'mysql-connector-python', 
    'sqlalchemy', 'peewee', 'tortoise-orm', 'databases', 'sqlite3',
    // Go
    'github.com/lib/pq', 'github.com/go-sql-driver/mysql', 
    'github.com/mattn/go-sqlite3', 'gorm.io/gorm',
    // Ruby
    'pg', 'mysql2', 'sqlite3', 'activerecord'
  ],
  redis: [
    // Node
    'redis', 'ioredis', 
    // Python
    'redis', 'walrus', 
    // Go
    'github.com/go-redis/redis', 'github.com/redis/go-redis',
    // Ruby
    'redis'
  ]
};

// Global system/dev keys to skip from automatic suggestions
const SKIP_VARS = new Set([
  'NODE_ENV', 'PORT', 'HOST', 'PATH', 'HOME', 'USER', 'PWD', 
  'SHELL', 'HOSTNAME', 'SHLVL', 'LANG', '_', 'DEBIAN_FRONTEND'
]);

/**
 * Parses manifests to collect project dependencies.
 * Supports package.json, requirements.txt, go.mod, Gemfile.
 */
function parseManifest(filePath, fileName, dependencies) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    if (fileName === 'package.json') {
      const pkg = JSON.parse(content);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
      Object.keys(deps).forEach(d => dependencies.add(d));
    } else if (fileName === 'requirements.txt') {
      content.split('\n').forEach(line => {
        const clean = line.trim();
        if (clean && !clean.startsWith('#')) {
          const name = clean.split(/[==|>=|<=|>|<|~=]/)[0].trim().toLowerCase();
          if (name) dependencies.add(name);
        }
      });
    } else if (fileName === 'go.mod') {
      content.split('\n').forEach(line => {
        const clean = line.trim();
        if (clean.startsWith('require')) {
          const parts = clean.split(/\s+/);
          if (parts[1]) dependencies.add(parts[1].replace(/['"`]/g, ''));
        }
      });
    } else if (fileName === 'Gemfile') {
      const matches = content.matchAll(/gem\s+['"]([^'"]+)['"]/g);
      for (const m of matches) {
        if (m[1]) dependencies.add(m[1].toLowerCase());
      }
    }
  } catch (err) {
    console.warn(`[Env Scanner] Error parsing manifest ${fileName}:`, err.message);
  }
}

/**
 * GitGuardian-style hardcoded secrets check
 */
function auditLeakedSecrets(code = '', fileName = '') {
  const leaks = [];

  // Google API Key
  const googleMatch = code.match(/AIzaSy[A-Za-z0-9_-]{33,35}/g);
  if (googleMatch) {
    googleMatch.forEach(key => leaks.push({
      type: 'Google API Key',
      file: fileName,
      leakedValue: key.slice(0, 8) + '...'
    }));
  }

  // MongoDB connection with password
  const mongoMatch = code.match(/mongodb(?:\+srv)?:\/\/[^:]+:[^@]+@/g);
  if (mongoMatch) {
    leaks.push({
      type: 'MongoDB Connection Credentials (Embedded Password)',
      file: fileName,
      leakedValue: 'mongodb://[user]:[pass]@...'
    });
  }

  // AWS Access Key ID
  const awsKeyMatch = code.match(/(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g);
  if (awsKeyMatch) {
    awsKeyMatch.forEach(key => leaks.push({
      type: 'AWS Access Key ID',
      file: fileName,
      leakedValue: key
    }));
  }

  // Slack Webhook
  const slackMatch = code.match(/https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/g);
  if (slackMatch) {
    slackMatch.forEach(webhook => leaks.push({
      type: 'Slack Webhook URL',
      file: fileName,
      leakedValue: webhook.slice(0, 30) + '...'
    }));
  }

  // Stripe Secret Key
  const stripeMatch = code.match(/sk_(?:live|test)_[0-9a-zA-Z]{24}/g);
  if (stripeMatch) {
    stripeMatch.forEach(key => leaks.push({
      type: 'Stripe Secret Key',
      file: fileName,
      leakedValue: key.slice(0, 12) + '...'
    }));
  }

  // JWT Secret / Session Key assignments
  const secretMatch = code.match(/(?:jwt_secret|jwtSecret|sessionSecret|cookieSecret|api_key|apiKey)\s*=\s*['"`]([a-zA-Z0-9_\-!@#$]{8,64})['"`]/gi);
  if (secretMatch) {
    secretMatch.forEach(match => leaks.push({
      type: 'Hardcoded Cryptographic Secret/Key Assignment',
      file: fileName,
      leakedValue: match
    }));
  }

  return leaks;
}

/**
 * Checks for redundant database or authentication environment keys
 */
function findVariableCollisions(keys = []) {
  const collisions = [];
  const upperKeys = keys.map(k => k.toUpperCase());

  if (upperKeys.includes('MONGO_URI') && upperKeys.includes('MONGODB_URI')) {
    collisions.push({
      type: 'Database URI Redundancy',
      message: 'Detected both MONGO_URI and MONGODB_URI. Standardize on MONGODB_URI to avoid driver mismatches.'
    });
  }
  if (upperKeys.includes('JWT_SECRET') && upperKeys.includes('JWT_TOKEN')) {
    collisions.push({
      type: 'JWT Secret Redundancy',
      message: 'Detected both JWT_SECRET and JWT_TOKEN. Standardize on JWT_SECRET.'
    });
  }
  if (upperKeys.includes('DATABASE_URL') && upperKeys.includes('DATABASE_URI')) {
    collisions.push({
      type: 'SQL Database URI Redundancy',
      message: 'Detected both DATABASE_URL and DATABASE_URI. Standardize on DATABASE_URL.'
    });
  }
  return collisions;
}

/**
 * Generate cryptographically secure suggested default values for secret keys
 */
function generateSuggestedValue(key) {
  const upper = key.toUpperCase();
  // Ensure we don't put random passwords in URLs or host configurations
  if (upper.includes('SECRET') || upper.includes('TOKEN') || upper.includes('KEY') || upper.includes('PASSWORD') || upper.includes('AUTH_SALT')) {
    if (!upper.includes('URI') && !upper.includes('URL') && !upper.includes('PATH') && !upper.includes('HOST')) {
      return crypto.randomBytes(32).toString('hex');
    }
  }
  return '';
}

/**
 * Core SRE Scanner: scans repository recursively
 */
function scanRepository(repoPath, stack = 'unknown') {
  const candidateKeys = new Set();
  const dependencies = new Set();
  const securityWarnings = [];
  let manifestScanned = false;

  if (!fs.existsSync(repoPath)) {
    return { candidateKeys: [], dependenciesList: [], securityWarnings: [], collisions: [] };
  }

  const readFilesRecursively = (dir, depth = 0) => {
    if (depth > 6) return;

    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (IGNORE_DIRS.has(file)) continue;

        const fullPath = path.join(dir, file);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            readFilesRecursively(fullPath, depth + 1);
          } else {
            if (IGNORE_FILES.has(file)) continue;

            const lowerFile = file.toLowerCase();

            // 1. Process config / dependency manifests (nested up to depth 3)
            const isManifest = ['package.json', 'requirements.txt', 'go.mod', 'Gemfile'].includes(file);
            if (isManifest && depth <= 3) {
              parseManifest(fullPath, file, dependencies);
              manifestScanned = true;
              continue; // Manifest processed, no need to read as source code
            }

            // 2. Process Env Templates (.env.example, .env.sample, etc.)
            const isEnvTemplate = lowerFile.includes('env.example') || lowerFile.includes('env.sample') || (lowerFile.startsWith('.env.') && !lowerFile.endsWith('.local') && !lowerFile.endsWith('.development') && !lowerFile.endsWith('.production'));
            const isDotEnv = file === '.env'; // Skip parsing local actual secrets if committed (but scan for warnings)

            if (isEnvTemplate || isDotEnv) {
              const content = fs.readFileSync(fullPath, 'utf8').slice(0, 50000); // 50KB limit
              
              // Extract defined env keys
              const lines = content.split('\n');
              lines.forEach(line => {
                const clean = line.trim();
                if (clean && !clean.startsWith('#') && clean.includes('=')) {
                  const key = clean.split('=')[0].trim();
                  if (/^[a-zA-Z_0-9]+$/.test(key)) {
                    candidateKeys.add(key);
                  }
                }
              });

              // Check for committed secrets in .env files
              if (isDotEnv) {
                const leaks = auditLeakedSecrets(content, file);
                securityWarnings.push(...leaks);
              }
              continue;
            }

            // 3. Process Source Code Files
            const isSourceFile = /\.(js|jsx|ts|tsx|py|go|rs|java|rb|php|cs|sh|prisma|sql|json)$/i.test(file);
            if (isSourceFile) {
              const content = fs.readFileSync(fullPath, 'utf8').slice(0, 102400); // 100KB limit
              
              // A. Standard node process.env.XYZ
              const nodeMatches = content.matchAll(/(?:process\.env|import\.meta\.env)\.([a-zA-Z_0-9]+)/g);
              for (const m of nodeMatches) {
                if (m[1]) candidateKeys.add(m[1]);
              }

              // B. Node destructured process.env calls
              const destructureMatches = content.matchAll(/(?:const|let|var)\s*\{\s*([A-Za-z0-9_,\s\n]+)\s*\}\s*=\s*process\.env/g);
              for (const dm of destructureMatches) {
                if (dm[1]) {
                  dm[1].split(',').map(k => k.trim()).forEach(k => {
                    if (k && /^[a-zA-Z_0-9]+$/.test(k)) {
                      candidateKeys.add(k);
                    }
                  });
                }
              }

              // C. Python os.environ.get('XYZ') or os.environ["XYZ"]
              const pyMatches = content.matchAll(/os\.environ(?:\[['"]|\.get\(['"])([a-zA-Z_0-9]+)/g);
              for (const m of pyMatches) {
                if (m[1]) candidateKeys.add(m[1]);
              }

              // D. Prisma env("XYZ")
              const prismaMatches = content.matchAll(/env\s*\(\s*['"]([a-zA-Z_0-9]+)['"]\s*\)/g);
              for (const m of prismaMatches) {
                if (m[1]) candidateKeys.add(m[1]);
              }

              // E. Fallback SRE scans (Only on Source files, NEVER templates)
              if (content.includes('mongodb://') || content.includes('mongodb+srv://') || /mongoose\.connect|mongodb\.connect/i.test(content)) {
                candidateKeys.add('MONGODB_URI');
                candidateKeys.add('MONGO_URI');
              }
              if (content.includes('postgresql://') || content.includes('postgres://') || content.includes('mysql://') || /pg\.Pool|mysql\.createConnection|Sequelize/i.test(content)) {
                candidateKeys.add('DATABASE_URL');
              }
              if (content.includes('redis://') || /new Redis|createClient/i.test(content)) {
                candidateKeys.add('REDIS_URL');
              }

              // F. Secret Leaks audit in source code
              const leaks = auditLeakedSecrets(content, file);
              securityWarnings.push(...leaks);
            }
          }
        } catch (fileErr) {
          console.warn(`[Env Scanner] Skipping scan on ${file}:`, fileErr.message);
        }
      }
    } catch (dirErr) {
      console.warn(`[Env Scanner] Skipping dir scan ${dir}:`, dirErr.message);
    }
  };

  readFilesRecursively(repoPath);

  // 4. Dependency-Aware Filtering
  let finalKeys = Array.from(candidateKeys)
    .map(k => k.toUpperCase())
    .filter(k => !SKIP_VARS.has(k));

  if (manifestScanned) {
    const hasMongoDep = DB_DRIVERS.mongodb.some(d => dependencies.has(d));
    const hasSqlDep = DB_DRIVERS.sql.some(d => dependencies.has(d));
    const hasRedisDep = DB_DRIVERS.redis.some(d => dependencies.has(d));

    finalKeys = finalKeys.filter(k => {
      // Skip MongoDB URIs if the project manifest exists but does not use MongoDB
      if (k === 'MONGODB_URI' || k === 'MONGO_URI') {
        return hasMongoDep;
      }
      // Skip SQL URIs if project manifest exists but does not use SQL packages
      if (k === 'DATABASE_URL') {
        return hasSqlDep;
      }
      // Skip Redis URIs if project manifest exists but does not use Redis packages
      if (k === 'REDIS_URL') {
        return hasRedisDep;
      }
      return true;
    });
  }

  // Deduplicate and sort
  const cleanKeys = Array.from(new Set(finalKeys)).sort();

  return {
    candidateKeys: cleanKeys,
    dependenciesList: Array.from(dependencies),
    securityWarnings,
    collisions: findVariableCollisions(cleanKeys)
  };
}

module.exports = {
  scanRepository,
  generateSuggestedValue
};
