const cron    = require('node-cron');
const Project = require('../models/Project.model');
const { getCachedStats, recordMetricSnapshot } = require('../services/metrics.service');
const { getIO } = require('../sockets/logs.socket');

// Runs every 10 seconds — polls all live containers and:
// 1. Records a snapshot to Redis history
// 2. Emits stats to any connected Socket.io clients watching that project
const startMetricsWorker = () => {
  // node-cron doesn't support sub-minute intervals natively for seconds,
  // so we use setInterval for 10-second polling
  setInterval(async () => {
    try {
      const liveProjects = await Project.find({ status: 'live', containerId: { $exists: true, $ne: null } })
        .select('_id containerId subdomain');

      for (const project of liveProjects) {
        try {
          const stats = await getCachedStats(project.containerId);
          await recordMetricSnapshot(project._id.toString(), stats);

          // Emit to clients watching this project's metrics room
          try {
            getIO()
              .to(`metrics:${project._id}`)
              .emit('metrics', { projectId: project._id, ...stats });
          } catch {
            // Socket.io not ready yet — skip
          }
        } catch (err) {
          console.warn(`Metrics poll failed for ${project.subdomain}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('Metrics worker error:', err.message);
    }
  }, 10_000);

  // Weekly SSL renewal cron (every Sunday at 3am)
  cron.schedule('0 3 * * 0', async () => {
    console.log('Running weekly SSL renewal…');
    const { renewAllSSL } = require('../services/ssl.service');
    renewAllSSL();
  });

  console.log('Metrics worker started (polling every 10s)');
};

module.exports = { startMetricsWorker };