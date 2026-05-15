const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const path    = require('path');
const { connectDB } = require('./lib/db');

const authRoutes    = require('./routes/auth.routes');
const projectRoutes = require('./routes/project.routes');
const deployRoutes  = require('./routes/deploy.routes');
const envRoutes     = require('./routes/env.routes');
const domainRoutes  = require('./routes/domain.routes');
const metricsRoutes = require('./routes/metrics.routes');

const app = express();

connectDB();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// API Routes
app.use('/api/auth',     authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/deploy',   deployRoutes);
app.use('/api/env',      envRoutes);
app.use('/api/domains',  domainRoutes);
app.use('/api/metrics',  metricsRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Serve static files from the React app
const clientDist = path.join(__dirname, '../../client/dist');
app.use(express.static(clientDist));

// The "catchall" handler: for any request that doesn't match one above, send back React's index.html file.
app.get(/(.*)/, (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;