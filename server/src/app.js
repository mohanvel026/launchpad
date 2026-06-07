const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const compression = require('compression');
const { connectDB } = require('./lib/db');

// ── Routes ────────────────────────────────────────────────────────────────────
const authRoutes      = require('./routes/auth.routes');
const projectRoutes   = require('./routes/project.routes');
const deployRoutes    = require('./routes/deploy.routes');
const envRoutes       = require('./routes/env.routes');
const domainRoutes    = require('./routes/domain.routes');
const metricsRoutes   = require('./routes/metrics.routes');
const aiRoutes        = require('./routes/ai.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const settingsRoutes  = require('./routes/settings.routes');
const teamRoutes      = require('./routes/team.routes');
const vulnRoutes      = require('./routes/vuln.routes');
const healthRoutes    = require('./routes/health.routes');
const previewRoutes   = require('./routes/preview.routes');
const abuseRoutes     = require('./routes/abuse.routes');

// ── Project Proxy ──────────────────────────────────────────────────────────────
const { projectProxyMiddleware } = require('./middleware/projectProxy.middleware');

const app = express();
// Trust Nginx reverse proxy — required for express-rate-limit to correctly
// read the real client IP from the X-Forwarded-For header
app.set('trust proxy', 1);
connectDB().then(() => {
  const Project = require('./models/Project.model');
  const { startMonitoring } = require('./services/healthMonitor.service');
  const { stopContainer } = require('./services/docker.service');

  // 1. Resume active container monitors on server boot
  Project.find({ status: 'live' })
    .then(projects => {
      console.log(`[HealthMonitor] Restoring health monitoring for ${projects.length} live projects...`);
      projects.forEach(p => {
        if (p.containerId) startMonitoring(p);
      });
    })
    .catch(err => console.error('[HealthMonitor] Restoring failed:', err));

  // 2. Clear stuck building previews on server boot
  Project.updateMany(
    { 'previews.status': 'building' },
    { $set: { 'previews.$[elem].status': 'failed', 'previews.$[elem].error': 'Build interrupted by server restart' } },
    { arrayFilters: [{ 'elem.status': 'building' }] }
  )
    .then(res => {
      if (res.modifiedCount > 0) {
        console.log(`[Preview] Cleaned up ${res.modifiedCount} stuck building previews.`);
      }
    })
    .catch(err => console.error('[Preview] Stuck clean up failed:', err));

  // 3. Hourly PR preview auto-cleanup: destroy previews older than 24 hours
  const cleanupStalePreviewsJob = async () => {
    try {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
      const projectsWithPreviews = await Project.find({ 'previews.0': { $exists: true } });
      for (const project of projectsWithPreviews) {
        const stalePreviews = (project.previews || []).filter(p =>
          p.status === 'live' && p.createdAt && new Date(p.createdAt) < cutoff
        );
        for (const preview of stalePreviews) {
          console.log(`[Preview] Auto-cleanup: destroying stale preview PR #${preview.prNumber} for project ${project._id}`);
          if (preview.containerId) {
            try { await stopContainer(preview.containerId); } catch {}
          }
        }
        if (stalePreviews.length > 0) {
          const stalePRNumbers = stalePreviews.map(p => p.prNumber);
          await Project.findByIdAndUpdate(project._id, {
            $pull: { previews: { prNumber: { $in: stalePRNumbers } } }
          });
          console.log(`[Preview] Cleaned up ${stalePreviews.length} stale previews for project ${project.name}`);
        }
      }
    } catch (err) {
      console.error('[Preview] Hourly cleanup failed:', err.message);
    }
  };

  // Run immediately on boot and then every hour
  cleanupStalePreviewsJob();
  setInterval(cleanupStalePreviewsJob, 60 * 60 * 1000);
});

// ── Security / logging (these don't consume the body, so they go first) ───────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ['https://launchlive.in', 'http://localhost:5173', 'http://localhost:4173'],
  credentials: true,
}));
if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('tiny'));
} else {
  // In production only log 4xx/5xx so errors are visible without noise
  app.use(morgan('combined', { skip: (req, res) => res.statusCode < 400 }));
}

// ── Auth rate limiter (brute-force protection) ─────────────────────────────────
const rateLimit = require('express-rate-limit');
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { message: 'Too many requests, please try again later.' },
});
app.use('/api/auth', authLimiter);

// ── Deploy rate limiter (anti-botnet protection) ──────────────────────────────
const deployLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { message: 'Deployment limit reached to prevent abuse. Try again later.' },
});
app.use('/api/deploy', deployLimiter);

// ── Enable compression for API and proxied responses ──────────────────────────
app.use(compression());

// ── Project subdomain proxy — MUST be before body parsers ─────────────────────
// When the Host header is a project subdomain (e.g. portfolio-xyz.nip.io),
// the request is piped directly to the Docker container and never reaches
// the API routes or body parsers below.
app.use(projectProxyMiddleware);

// ── Body parsers (only reached for requests to 129.159.22.142.nip.io itself) ──
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString('utf-8');
  }
}));
app.use(express.urlencoded({ extended: true }));

// ── API Routes ─────────────────────────────────────────────────────────────────
app.use('/api/auth',      authRoutes);
app.use('/api/projects',  projectRoutes);
app.use('/api/deploy',    deployRoutes);
app.use('/api/env',       envRoutes);
app.use('/api/domains',   domainRoutes);
app.use('/api/metrics',   metricsRoutes);
app.use('/api/ai',        aiRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings',  settingsRoutes);
app.use('/api/team',      teamRoutes);
app.use('/api/vuln',      vulnRoutes);
app.use('/api/health',   healthRoutes);
app.use('/api/previews', previewRoutes);
app.use('/api/abuse',    abuseRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Serve LaunchLive React dashboard (SPA fallback) ────────────────────────────
const clientDist = path.join(__dirname, '../../client/dist');

// Long-term immutable cache for hashed JS/CSS/font bundles (Vite adds content hashes)
// HTML is always fetched fresh so React updates deploy instantly
app.use(express.static(clientDist, {
  etag: true,
  lastModified: true,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    } else if (/\.(js|css|woff2?|ttf|eot|svg|png|jpg|ico)$/.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }
}));

// Exclude /api/* routes so a missing API endpoint doesn't silently return index.html
app.get(/^\/(?!api).*$/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[app error]', err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;