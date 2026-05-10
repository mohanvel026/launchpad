const cron    = require('node-cron');
const Docker  = require('dockerode');
const Project = require('../models/Project.model');
const { sendDeployNotification } = require('../services/notification.service');

const docker = new Docker(
  process.platform === 'win32'
    ? { host: '127.0.0.1', port: 2375 }
    : { socketPath: '/var/run/docker.sock' }
);

// Check all live projects every 2 minutes
// If a container has crashed, update the project status and notify the owner
const startHealthChecker = () => {
  cron.schedule('*/2 * * * *', async () => {
    try {
      const liveProjects = await Project.find({ status: 'live', containerId: { $exists: true, $ne: null } })
        .populate('owner', 'email username');

      for (const project of liveProjects) {
        try {
          const container = docker.getContainer(project.containerId);
          const info      = await container.inspect();

          if (!info.State.Running) {
            console.log(`Container crashed for ${project.name} — updating status`);
            await Project.findByIdAndUpdate(project._id, { status: 'failed' });

            // Notify owner
            if (project.owner?.email) {
              await sendDeployNotification(project.owner.email, {
                projectName: project.name,
                status:      'failed',
                url:         `${process.env.CLIENT_URL}/projects/${project._id}`,
                commitMsg:   'Container crashed — auto-detected by health checker',
              });
            }
          }
        } catch (err) {
          // Container not found — mark project as stopped
          if (err.statusCode === 404) {
            await Project.findByIdAndUpdate(project._id, { status: 'stopped' });
          }
        }
      }
    } catch (err) {
      console.warn('Health checker error:', err.message);
    }
  });

  console.log('Health checker started (runs every 2 minutes)');
};

module.exports = { startHealthChecker };