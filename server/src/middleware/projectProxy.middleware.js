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

const DOMAIN = (process.env.CLOUDFLARE_DOMAIN || '129.159.22.142.nip.io').toLowerCase();

// ── Simple in-memory cache so MongoDB isn't hit on every request ──────────────
const portCache = new Map(); // subdomain → { port, ts }
const CACHE_TTL = 30_000;   // 30 seconds

const lookupPort = async (subdomain) => {
  const cached = portCache.get(subdomain);
  if (cached && Date.now() - cached.ts < CACHE_TTL) return cached.port;

  const project = await Project.findOne({ subdomain }, 'port status').lean();
  const port    = project?.port || null;
  if (port) portCache.set(subdomain, { port, ts: Date.now() });
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

// ── Middleware ─────────────────────────────────────────────────────────────────
const projectProxyMiddleware = async (req, res, next) => {
  const host = (req.headers.host || '').toLowerCase().split(':')[0]; // strip port

  // Only intercept project subdomains, not the root LaunchPad domain
  if (host === DOMAIN || !host.endsWith(`.${DOMAIN}`)) return next();

  const subdomain = host.slice(0, -(DOMAIN.length + 1)); // strip ".domain"

  // Sanity check — project subdomains are flat (no dots)
  if (!subdomain || subdomain.includes('.')) return next();

  try {
    const port = await lookupPort(subdomain);

    if (!port) {
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
    const proxyReq = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path:     req.url,
        method:   req.method,
        headers:  { ...req.headers, host: req.headers.host },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      }
    );

    proxyReq.on('error', (err) => {
      console.error(`[proxy] ${subdomain}:${port} error:`, err.message);
      // Invalidate cache so next request re-checks the DB
      portCache.delete(subdomain);

      if (!res.headersSent) {
        res.status(502).set('Content-Type', 'text/html').send(errorPage(
          'Application Not Responding',
          `Your app at <code style="color:#38bdf8">${host}</code> is not responding.<br>
           It may still be starting up — try again in a few seconds.`
        ));
      }
    });

    req.pipe(proxyReq, { end: true });

  } catch (err) {
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
