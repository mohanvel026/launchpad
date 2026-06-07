/**
 * projectProxy.middleware.js
 *
 * LaunchLive acts as its own reverse proxy.
 * Intercepts requests for project subdomains at the Node level:
 *
 *   stockflow-abc.launchlive.is-a.dev     →  container on port 4002
 *   myapp.launchlive.duckdns.org           →  container on port 4004
 *   129.159.22.142.nip.io                 →  LaunchLive dashboard
 *
 * Works with ANY domain configured via CLOUDFLARE_DOMAIN env var.
 * Also supports custom domains (CNAME pointing to LaunchLive).
 */

const http    = require('http');
const Project = require('../models/Project.model');
const { recordVisit } = require('../services/analytics.service');

const DOMAIN = (process.env.CLOUDFLARE_DOMAIN || 'launchlive.in').toLowerCase();

// ── Simple in-memory cache so MongoDB isn't hit on every request ──────────────
const portCache = new Map(); // subdomain → { port, projectId, ts }
const CACHE_TTL = 30_000;   // 30 seconds

const lookupPort = async (identifier, isCustomDomain = false) => {
  const cached = portCache.get(identifier);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached;

  const query = isCustomDomain ? { customDomain: identifier } : { subdomain: identifier };
  const project = await Project.findOne(query, 'port status stack containerId subdomain').lean();
  if (project && (project.port !== undefined || project.status === 'live' || project.status === 'sleeping')) {
    const data = {
      port: project.port || 0,
      projectId: project._id.toString(),
      subdomain: project.subdomain,
      stack: project.stack || 'unknown',
      status: project.status,
      containerId: project.containerId,
      ts: Date.now()
    };
    portCache.set(identifier, data);
    return data;
  }
  return null;
};

/** Call this after a successful deploy so the next request picks up the new port */
const invalidateProjectCache = (subdomain) => {
  if (!subdomain) return;
  portCache.delete(subdomain);
  for (const [key, value] of portCache.entries()) {
    if (value && value.subdomain === subdomain) {
      portCache.delete(key);
    }
  }
};

// ── Error page ─────────────────────────────────────────────────────────────────
const errorPage = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title} — LaunchLive</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:system-ui,sans-serif;background:#0a0a0f;color:#e2e8f0;
       display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:40px}
  .card{background:#12121a;border:1px solid #1e1e2e;border-radius:16px;padding:48px 40px;max-width:520px}
  h1{font-size:3rem;margin-bottom:8px}
  h2{font-size:1.25rem;color:#94a3b8;margin-bottom:24px;font-weight:400}
  p{color:#64748b;line-height:1.6;font-size:.95rem}
  .badge{display:inline-block;margin-top:24px;padding:6px 16px;border-radius:99px;
         background:#1e293b;color:#38bdf8;font-size:.8rem;font-family:monospace}
</style></head>
<body><div class="card">
  <h1>🚀</h1><h2>${title}</h2><p>${body}</p>
</div></body></html>`;

const selfHealingPage = (host) => `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="refresh" content="3">
  <title>Self-Healing Recovery — LaunchLive</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Inter', -apple-system, sans-serif;
      background: radial-gradient(circle at center, #0f0f18 0%, #050508 100%);
      color: #f8fafc;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      overflow: hidden;
    }
    .container {
      background: rgba(18, 18, 30, 0.4);
      backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      padding: 48px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8);
    }
    .ring { width: 80px; height: 80px; border-radius: 50%; border: 3px solid rgba(56,189,248,0.1); border-top-color: #38bdf8; animation: spin 1s linear infinite; margin: 0 auto 32px; }
    h1 { font-size: 1.6rem; font-weight: 800; margin-bottom: 12px; background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    p { color: #94a3b8; font-size: 0.95rem; line-height: 1.6; }
    @keyframes spin { 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div class="ring"></div>
    <h1>Self-Healing Recovery</h1>
    <p>Your app at <code style="color:#e2e8f0">${host}</code> went offline. LaunchLive is auto-restarting it. Reloading in 3s...</p>
  </div>
</body>
</html>`;

// ── Extract subdomain from host ────────────────────────────────────────────────
/**
 * Given: host = "myapp.launchpad.is-a.dev" and DOMAIN = "launchpad.is-a.dev"
 * Returns: { subdomain: "myapp", isCustomDomain: false }
 *
 * Given: host = "mycustomdomain.com" and it doesn't end with DOMAIN
 * Returns: { subdomain: "mycustomdomain.com", isCustomDomain: true }
 *
 * ✅ FIX: No longer rejects subdomains with dots in them — 
 *         the DOMAIN itself may have dots (nip.io, is-a.dev etc.)
 *         We only extract the FIRST label before the domain.
 */
const extractSubdomain = (host) => {
  const h = host.toLowerCase().split(':')[0]; // strip port

  // Root domain — LaunchLive dashboard itself
  if (h === DOMAIN) return { subdomain: null, isCustomDomain: false, isRoot: true };

  // Project subdomain: host ends with .DOMAIN
  if (h.endsWith(`.${DOMAIN}`)) {
    const sub = h.slice(0, -(DOMAIN.length + 1));
    // sub may be like "myapp" or "myapp-xyz123"
    // We allow dashes but NOT nested dots (prevent double-subdomain confusion)
    if (!sub || sub.includes('.')) {
      // Multi-level subdomain under our domain — not a valid project slug
      return { subdomain: null, isCustomDomain: false, isRoot: false };
    }
    return { subdomain: sub, isCustomDomain: false, isRoot: false };
  }

  // Custom domain — not our domain at all
  return { subdomain: h, isCustomDomain: true, isRoot: false };
};

// ── Middleware ─────────────────────────────────────────────────────────────────
const projectProxyMiddleware = async (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  const { subdomain, isCustomDomain, isRoot } = extractSubdomain(host);

  // Root domain → LaunchLive dashboard
  if (isRoot) return next();
  // Unresolvable — pass through to Express app
  if (!subdomain && !isCustomDomain) return next();

  try {
    let projectData = await lookupPort(subdomain, isCustomDomain);

    // Fallback: If no project found and this is a custom domain mapped under our base suffix
    if (!projectData && !isCustomDomain && host) {
      projectData = await lookupPort(host, true);
    }

    if (!projectData) {
      if (isCustomDomain) return next();
      return res
        .status(502)
        .set('Content-Type', 'text/html')
        .send(errorPage(
          'Not Deployed Yet',
          `No active deployment found for <code style="color:#38bdf8">${subdomain}</code>.<br>
           Deploy your project from the LaunchLive dashboard first.`
        ));
    }

    const { port, projectId, stack, status, containerId } = projectData;

    // ── Wake up sleeping container (Scale-to-Zero) ─────────────────────────────
    if (status === 'sleeping' && containerId) {
      try {
        console.log(`[proxy] Waking up sleeping container ${containerId} for ${subdomain}...`);
        const Docker = require('dockerode');
        const docker = new Docker(
          process.platform === 'win32'
            ? { host: '127.0.0.1', port: 2375 }
            : { socketPath: '/var/run/docker.sock' }
        );
        const container = docker.getContainer(containerId);
        const info = await container.inspect();
        if (!info.State.Running) await container.start();

        // Wait for port to be ready (up to 10s)
        const net = require('net');
        await new Promise((resolve) => {
          const startTime = Date.now();
          const tryConnect = () => {
            const socket = net.connect({ port, host: '127.0.0.1' }, () => { socket.end(); resolve(true); });
            socket.on('error', () => {
              if (Date.now() - startTime > 10000) resolve(false);
              else setTimeout(tryConnect, 100);
            });
          };
          tryConnect();
        });

        await Project.findByIdAndUpdate(projectId, { status: 'live' });
        projectData.status = 'live';
        portCache.set(subdomain, { ...projectData, status: 'live', ts: Date.now() });
        console.log(`[proxy] Container woke up successfully for ${subdomain}`);
      } catch (wakeErr) {
        console.error(`[proxy] Wakeup failed:`, wakeErr.message);
        return res.status(502).set('Content-Type', 'text/html').send(
          errorPage('Application Wakeup Failed', `Could not auto-wake <code>${subdomain}</code>. Error: ${wakeErr.message}`)
        );
      }
    }

    // ── Windows dev mode: serve static files directly ─────────────────────────
    const isWindows = process.platform === 'win32';
    const isStaticStack = ['static', 'react', 'vue', 'svelte', 'astro', 'angular'].includes(stack);

    if (isWindows && isStaticStack) {
      const fs = require('fs');
      const path = require('path');
      const repoPath = path.join(__dirname, '../../repos', projectId);
      let buildDir = repoPath;
      if (stack !== 'static') {
        const { getBuildOutput } = require('../services/stackDetector.service');
        const outDir = getBuildOutput(repoPath);
        buildDir = path.join(repoPath, outDir);
        if (!fs.existsSync(buildDir)) buildDir = repoPath;
      }
      if (fs.existsSync(buildDir) && fs.statSync(buildDir).isDirectory()) {
        let targetPath = path.join(buildDir, req.path);
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {
          const idx = path.join(targetPath, 'index.html');
          targetPath = fs.existsSync(idx) ? idx : targetPath;
        }
        if (!fs.existsSync(targetPath)) {
          if (fs.existsSync(targetPath + '.html')) targetPath = targetPath + '.html';
          else targetPath = path.join(buildDir, 'index.html');
        }
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) {
          recordVisit(projectId, 0, 200, req.method, req.url, req.ip || req.connection.remoteAddress).catch(() => {});
          return res.sendFile(targetPath);
        }
      }
    }

    // ── Proxy request to the container ────────────────────────────────────────
    console.log(`[proxy] ${subdomain} → :${port} ${req.method} ${req.url}`);
    const startTime = Date.now();

    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path:     req.url,
        method:   req.method,
        headers:  {
          ...req.headers,
          host: req.headers.host,
          'X-Forwarded-For':   req.ip || req.connection.remoteAddress,
          'X-Forwarded-Proto': req.secure ? 'https' : 'http',
          'X-Real-IP':         req.ip || req.connection.remoteAddress,
        },
      },
      (proxyRes) => {
        recordVisit(
          projectId,
          Date.now() - startTime,
          proxyRes.statusCode,
          req.method,
          req.url,
          req.ip || req.connection.remoteAddress
        ).catch(() => {});
        const responseHeaders = { ...proxyRes.headers };
        responseHeaders['X-Powered-By'] = 'LaunchLive (User-Generated Content)';
        responseHeaders['X-Abuse-Report'] = 'abuse@launchlive.in';
        responseHeaders['X-Platform-Notice'] = 'This is a user-generated environment. Do not submit sensitive personal information.';
        
        res.writeHead(proxyRes.statusCode, responseHeaders);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      console.error(`[proxy] ${subdomain}:${port} error:`, err.message);
      portCache.delete(subdomain);

      if (!res.headersSent) {
        // Attempt self-healing: restart the container
        Project.findOne({ subdomain }).then(async (project) => {
          if (project?.containerId) {
            try {
              const Docker = require('dockerode');
              const docker = new Docker(
                process.platform === 'win32'
                  ? { host: '127.0.0.1', port: 2375 }
                  : { socketPath: '/var/run/docker.sock' }
              );
              const container = docker.getContainer(project.containerId);
              const info = await container.inspect();
              if (!info.State.Running) {
                console.log(`[proxy SRE] Auto-starting stopped container for ${project.name}`);
                await container.start();
              }
            } catch (e) {
              console.warn('[proxy SRE] Auto-restart failed:', e.message);
            }
          }
        }).catch(() => {});

        res.status(502).set('Content-Type', 'text/html').send(selfHealingPage(host));
      }
    });

    req.pipe(proxyReq, { end: true });

  } catch (err) {
    console.error(`[proxy] middleware error:`, err);
    next(err);
  }
};

// ── WebSocket proxy ─────────────────────────────────────────────────────────────
const handleWsUpgrade = async (req, socket, head) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  const { subdomain, isCustomDomain, isRoot } = extractSubdomain(host);
  if (isRoot || !subdomain) return;

  try {
    let projectData = await lookupPort(subdomain, isCustomDomain);
    if (!projectData && !isCustomDomain && host) {
      projectData = await lookupPort(host, true);
    }
    if (!projectData) { socket.destroy(); return; }

    const proxySocket = require('net').createConnection(projectData.port, '127.0.0.1', () => {
      proxySocket.write(
        `${req.method} ${req.url} HTTP/1.1\r\n` +
        Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join('\r\n') +
        '\r\n\r\n'
      );
      if (head?.length) proxySocket.write(head);
      socket.pipe(proxySocket);
      proxySocket.pipe(socket);
    });

    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
  } catch { socket.destroy(); }
};

module.exports = { projectProxyMiddleware, handleWsUpgrade, invalidateProjectCache };
