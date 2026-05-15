const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
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

// ── Project Proxy ──────────────────────────────────────────────────────────────
const { projectProxyMiddleware } = require('./middleware/projectProxy.middleware');

const app = express();
connectDB();

// ── Security / logging (these don't consume the body, so they go first) ───────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(morgan('dev'));

// ── Project subdomain proxy — MUST be before body parsers ─────────────────────
// When the Host header is a project subdomain (e.g. portfolio-xyz.nip.io),
// the request is piped directly to the Docker container and never reaches
// the API routes or body parsers below.
app.use(projectProxyMiddleware);

// ── Body parsers (only reached for requests to 129.159.22.142.nip.io itself) ──
app.use(express.json());
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

app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Serve LaunchPad React dashboard (SPA fallback) ────────────────────────────
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ── Global error handler ───────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[app error]', err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;