/**
 * projectProxy.middleware.js
 *
 * LaunchPad acts as its own reverse proxy.
 * Instead of writing a new nginx config per project (which needs sudo/permissions),
 * this middleware intercepts requests for project subdomains at the Node level:
 *
 *   portfolio-html-xyz.129.159.22.142.nip.io  →  container on port 4004
 *   stockflow-abc.129.159.22.142.nip.io        →  container on port 4002
 *   129.159.22.142.nip.io                      →  LaunchPad dashboard (passes through)
 *
 * Requires ONE nginx rule:  server_name *.nip.io → proxy_pass localhost:5000
 */

const http    = require('http');
const Project = require('../models/Project.model');
const { recordVisit } = require('../services/analytics.service');

const DOMAIN = (process.env.CLOUDFLARE_DOMAIN || '129.159.22.142.nip.io').toLowerCase();

// ── Simple in-memory cache so MongoDB isn't hit on every request ──────────────
const portCache = new Map(); // subdomain → { port, ts }
const CACHE_TTL = 30_000;   // 30 seconds

const lookupPort = async (identifier, isCustomDomain = false) => {
  const cached = portCache.get(identifier);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.port;

  const query = isCustomDomain ? { customDomain: identifier } : { subdomain: identifier };
  const project = await Project.findOne(query, 'port status').lean();
  const port    = project?.port || null;
  if (port) portCache.set(identifier, { port, ts: Date.now() });
  return port;
};

/** Call this after a successful deploy so the next request picks up the new port */
const invalidateProjectCache = (subdomain) => portCache.delete(subdomain);

// ── Error page ─────────────────────────────────────────────────────────────────
const errorPage = (title, body) => `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>${title} — LaunchPad</title>
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
  <title>Self-Healing Recovery — LaunchPad</title>
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
      -webkit-backdrop-filter: blur(20px);
      border: 1px solid rgba(255, 255, 255, 0.05);
      border-radius: 24px;
      padding: 48px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 24px 60px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05);
      position: relative;
    }
    .ring-container {
      display: flex;
      justify-content: center;
      align-items: center;
      margin-bottom: 32px;
      position: relative;
    }
    .ring {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      border: 3px solid rgba(56, 189, 248, 0.1);
      border-top-color: #38bdf8;
      animation: spin 1s linear infinite;
    }
    .pulse-glow {
      position: absolute;
      width: 70px;
      height: 70px;
      border-radius: 50%;
      background: radial-gradient(circle, rgba(56, 189, 248, 0.2) 0%, transparent 70%);
      animation: pulse 2s ease-in-out infinite;
    }
    h1 {
      font-size: 1.6rem;
      font-weight: 800;
      letter-spacing: -0.5px;
      margin-bottom: 12px;
      background: linear-gradient(135deg, #38bdf8 0%, #818cf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p {
      color: #94a3b8;
      font-size: 0.95rem;
      line-height: 1.6;
      margin-bottom: 24px;
    }
    .status-box {
      background: rgba(56, 189, 248, 0.05);
      border: 1px solid rgba(56, 189, 248, 0.15);
      border-radius: 12px;
      padding: 12px 20px;
      font-size: 0.85rem;
      color: #38bdf8;
      font-family: monospace;
      display: inline-flex;
      align-items: center;
      gap: 10px;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #38bdf8;
      box-shadow: 0 0 8px #38bdf8;
      animation: blink 1.5s infinite;
    }
    @keyframes spin { 100% { transform: rotate(360deg); } }
    @keyframes pulse {
      0%, 100% { transform: scale(1); opacity: 0.3; }
      50% { transform: scale(1.3); opacity: 0.8; }
    }
    @keyframes blink {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="ring-container">
      <div class="pulse-glow"></div>
      <div class="ring"></div>
    </div>
    <h1>Self-Healing App Recovery</h1>
    <p>Your application at <code style="color: #e2e8f0; font-weight: 600;">${host}</code> went offline. LaunchPad SRE is automatically rebuilding and restarting the container.</p>
    <div class="status-box">
      <div class="status-dot"></div>
      <span>Auto-restarting container... Reloading in 3s</span>
    </div>
  </div>
</body>
</html>`;

// ── Middleware ─────────────────────────────────────────────────────────────────
const projectProxyMiddleware = async (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0]; // strip port

  // 1. Let the root LaunchPad dashboard domain pass through
  if (host === DOMAIN) return next();

  let subdomain = null;
  let isCustomDomain = false;

  // 2. Check if this is a LaunchPad subdomain
  if (host.endsWith(`.${DOMAIN}`)) {
    subdomain = host.slice(0, -(DOMAIN.length + 1));
    // Sanity check
    if (!subdomain || subdomain.includes('.')) return next();
  } else {
    // 3. Otherwise, treat it as a potential custom domain
    subdomain = host;
    isCustomDomain = true;
  }

  try {
    const port = await lookupPort(subdomain, isCustomDomain);

    if (!port) {
      // If it doesn't match any registered custom domain, fall back to the LaunchPad dashboard
      if (isCustomDomain) return next();

      return res
        .status(502)
        .set('Content-Type', 'text/html')
        .send(errorPage(
          'Not Deployed Yet',
          `No active deployment found for <code style="color:#38bdf8">${subdomain}</code>.<br>
           Deploy your project from the LaunchPad dashboard first.`
        ));
    }

    // ── Pipe the request to the container ──────────────────────────────────────
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
        const responseTime = Date.now() - startTime;
        const statusCode = proxyRes.statusCode;

        // Log traffic analytics to Redis/DB edge counters asynchronously
        Project.findOne({ $or: [{ subdomain }, { customDomain: subdomain }] }).then((proj) => {
          if (proj) {
            recordVisit(proj._id.toString(), responseTime, statusCode).catch((err) => {
              console.warn('[Proxy Traffic Audit Error]:', err.message);
            });
          }
        }).catch(() => {});

        res.writeHead(statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      console.error(`[proxy] ${subdomain}:${port} error:`, err.message);
      // Invalidate cache so next request re-checks the DB
      portCache.delete(subdomain);
 
      if (!res.headersSent) {
        // Asynchronously trigger self-healing restart of the docker container
        Project.findOne({ subdomain }).then(async (project) => {
          if (project && project.containerId) {
            try {
              const Docker = require('dockerode');
              const docker = new Docker({ socketPath: '/var/run/docker.sock' });
              const container = docker.getContainer(project.containerId);
              const info = await container.inspect();
              if (!info.State.Running) {
                console.log(`[proxy SRE Self-Healing] Auto-starting stopped container ${project.containerId} for ${project.name}`);
                await container.start();
              }
            } catch (restartErr) {
              console.warn('[proxy SRE Self-Healing] Failed to auto-restart container:', restartErr.message);
            }
          }
        }).catch(err => console.error('[proxy SRE Self-Healing] DB fetch failed:', err.message));

        res.status(502).set('Content-Type', 'text/html').send(selfHealingPage(host));
      }
    });

    req.pipe(proxyReq, { end: true });

  } catch (err) {
    console.error(`[proxy] middleware error:`, err);
    next(err);
  }
};

// ── WebSocket proxy (called from server.js on 'upgrade' event) ─────────────────
const handleWsUpgrade = async (req, socket, head) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0];
  if (host === DOMAIN || !host.endsWith(`.${DOMAIN}`)) return;

  const subdomain = host.slice(0, -(DOMAIN.length + 1));
  if (!subdomain || subdomain.includes('.')) return;

  try {
    const port = await lookupPort(subdomain);
    if (!port) { socket.destroy(); return; }

    const proxySocket = require('net').createConnection(port, '127.0.0.1', () => {
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
