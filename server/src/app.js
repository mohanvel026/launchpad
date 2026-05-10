const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const morgan  = require('morgan');
const { connectDB } = require('./lib/db');

const authRoutes    = require('./routes/auth.routes');
const projectRoutes = require('./routes/project.routes');
const deployRoutes  = require('./routes/deploy.routes');
const envRoutes     = require('./routes/env.routes');
const domainRoutes  = require('./routes/domain.routes');
const metricsRoutes = require('./routes/metrics.routes');

const app = express();

connectDB();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth',     authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/deploy',   deployRoutes);
app.use('/api/env',      envRoutes);
app.use('/api/domains',  domainRoutes);
app.use('/api/metrics',  metricsRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({ message: err.message || 'Internal server error' });
});

module.exports = app;