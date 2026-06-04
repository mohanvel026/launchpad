const cron    = require('node-cron');
const Docker  = require('dockerode');
const Project = require('../models/Project.model');
const { sendDeployNotification } = require('../services/notification.service');

const docker = new Docker(
  process.platform === 'win32'
    ? { host: '127.0.0.1', port: 2375 }
    : { socketPath: '/var/run/docker.sock' }
);

/**
 * Health checker, Inactivity Auto-Sleep, and Docker Image Pruner workers.
 */
const startHealthChecker = () => {
  // 1. Check all live projects every 2 minutes for crash recovery
  cron.schedule('*/2 * * * *', async () => {
    try {
      const liveProjects = await Project.find({ status: 'live', containerId: { $exists: true, $ne: null } })
        .populate('owner', 'email username');

      for (const project of liveProjects) {
        try {
          const container = docker.getContainer(project.containerId);
          const info      = await container.inspect();

          if (!info.State.Running) {
            console.log(`[Health-Check] Container crashed for project ${project.name} — updating status`);
            await Project.findByIdAndUpdate(project._id, { status: 'failed' });

            // Notify owner
            if (project.owner?.email) {
              await sendDeployNotification(project.owner.email, {
                projectName: project.name,
                status:      'failed',
                url:         `${process.env.CLIENT_URL || 'http://localhost:3000'}/projects/${project._id}`,
                commitMsg:   'Container crashed — auto-detected by SRE health checker',
              });
            }
          }
        } catch (err) {
          // Container not found — mark project as stopped
          if (err.statusCode === 404) {
            console.log(`[Health-Check] Container not found for project ${project.name} — marking stopped`);
            await Project.findByIdAndUpdate(project._id, { status: 'stopped' });
          }
        }
      }
    } catch (err) {
      console.warn('[Health-Check Worker Error]:', err.message);
    }
  });
  console.log('SRE Health checker worker active (every 2 minutes)');

  // 2. Scale-to-Zero Container Auto-Sleep (runs every 5 minutes)
  cron.schedule('*/5 * * * *', async () => {
    const isWindows = process.platform === 'win32';
    if (isWindows) return; // Skip Docker stop actions on Windows development

    try {
      const liveProjects = await Project.find({ status: 'live', containerId: { $exists: true, $ne: null } });
      const { getRedis } = require('../services/analytics.service');
      const redisClient = await getRedis();

      for (const project of liveProjects) {
        // Skip static stacks (they don't run containers)
        const isStatic = ['static', 'react', 'vue', 'svelte', 'astro', 'angular'].includes(project.stack);
        if (isStatic) continue;

        try {
          const lastTraffic = await redisClient.hGet(`analytics:${project._id}`, 'lastTrafficAt');
          const lastTime = lastTraffic ? parseInt(lastTraffic) : null;
          
          const idleTimeoutMs = 15 * 60 * 1000; // 15 minutes of inactivity
          const now = Date.now();

          let shouldSleep = false;
          if (lastTime) {
            if (now - lastTime > idleTimeoutMs) {
              shouldSleep = true;
            }
          } else {
            // If no traffic yet, sleep if created/deployed/updated > 15 minutes ago
            const createdOrDeployed = project.lastDeployedAt || project.updatedAt || project.createdAt;
            if (now - new Date(createdOrDeployed).getTime() > idleTimeoutMs) {
              shouldSleep = true;
            }
          }

          if (shouldSleep) {
            console.log(`[Auto-Sleep] Project ${project.name} (${project._id}) is idle. Scaling to zero...`);
            const container = docker.getContainer(project.containerId);
            const info = await container.inspect();
            if (info.State.Running) {
              await container.stop({ t: 5 });
              console.log(`[Auto-Sleep] Successfully stopped idle container: ${project.containerId}`);
            }
            
            project.status = 'sleeping';
            await project.save();

            // Flush proxy cache so it re-triggers wakeup on next request
            const { invalidateProjectCache } = require('../middleware/projectProxy.middleware');
            invalidateProjectCache(project.subdomain);
          }
        } catch (err) {
          console.warn(`[Auto-Sleep] Failed to sleep project ${project.name}:`, err.message);
        }
      }
    } catch (err) {
      console.warn('[Auto-Sleep Worker Error]:', err.message);
    }
  });
  console.log('SRE Inactivity Auto-Sleep worker active (every 5 minutes)');

  // 3. Docker Image Pruning (runs every day at 3:00 AM)
  cron.schedule('0 3 * * *', () => {
    const isWindows = process.platform === 'win32';
    if (isWindows) return;

    console.log('[Docker-Pruner] Running scheduled Docker image cleanup...');
    const { exec } = require('child_process');
    exec('docker image prune -a -f --filter "until=24h"', (err, stdout, stderr) => {
      if (err) {
        console.error('[Docker-Pruner] Error pruning images:', err.message);
        return;
      }
      console.log('[Docker-Pruner] Cleanup finished successfully:\n', stdout);
    });
  });
  console.log('SRE Docker image pruner worker active (daily at 3:00 AM)');
};

module.exports = { startHealthChecker };