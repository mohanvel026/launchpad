const { execSync } = require('child_process');
const { inspectRuntimeLogs } = require('./ai.service');
const { restartContainer } = require('./docker.service');

// In-memory store for active monitors: { projectId: { intervalId, lastScore, alerts } }
const monitors = new Map();

/**
 * Starts periodic AI health monitoring for a container.
 * Polls docker logs every 90 seconds, runs AI inspection, stores result, and auto-restarts on critical failures.
 */
function startMonitoring(project) {
  const { _id: projectId, containerId } = project;
  if (!containerId || containerId === 'local-static') return;

  // Stop existing monitor if any
  stopMonitoring(projectId);

  const intervalId = setInterval(async () => {
    try {
      const Project = require('../models/Project.model');
      const proj = await Project.findById(projectId);
      if (!proj) {
        stopMonitoring(projectId);
        return;
      }

      const currentContainerId = proj.containerId;
      const stack = proj.stack || 'unknown';

      // 1. Verify container exists and get its running state
      let containerState = ''; // 'running' | 'stopped' | 'missing'
      try {
        const inspectOut = execSync(`docker inspect -f "{{.State.Status}}" ${currentContainerId}`, { stdio: 'pipe', timeout: 15000 }).toString().trim();
        containerState = inspectOut; // e.g., 'running', 'exited', 'paused'
      } catch (e) {
        console.error(`[HealthMonitor] docker inspect failed for container ${currentContainerId}:`, e.message);
        containerState = 'missing';
      }

      if (containerState === 'missing') {
        console.warn(`[HealthMonitor] Container ${currentContainerId} is missing for project ${projectId}.`);
        await Project.findByIdAndUpdate(projectId, { lastHealthScore: 0, status: 'failed' });
        await notifyUpdate(projectId);
        stopMonitoring(projectId);
        return;
      }

      if (containerState !== 'running') {
        console.warn(`[HealthMonitor] Container ${currentContainerId} is not running (state: ${containerState}). Attempting recovery restart...`);
        try {
          const { startContainer } = require('./docker.service');
          await startContainer(currentContainerId);
          console.log(`[HealthMonitor] Container ${currentContainerId} started successfully during recovery.`);
          await Project.findByIdAndUpdate(projectId, { lastHealthScore: 60, status: 'live' });
          await notifyUpdate(projectId);
          return; // Skip log analysis this tick, let it boot
        } catch (startErr) {
          console.error(`[HealthMonitor] Failed to start container ${currentContainerId}:`, startErr.message);
          await Project.findByIdAndUpdate(projectId, { lastHealthScore: 10, status: 'failed' });
          await notifyUpdate(projectId);
          return;
        }
      }

      // 2. Container is running, fetch logs
      let logs = '';
      try {
        logs = execSync(`docker logs --tail 200 --since 90s ${currentContainerId} 2>&1`, { timeout: 20000 }).toString();
      } catch (e) {
        console.error(`[HealthMonitor] docker logs failed for container ${currentContainerId}:`, e.message);
        logs = e.stdout?.toString() || e.stderr?.toString() || '';
      }

      // AI log inspection
      let logHealthScore = 100;
      let logAnomalies = [];
      let logHealthy = true;

      if (logs.trim()) {
        const result = await inspectRuntimeLogs(logs, stack);
        logHealthy = result.isHealthy;
        logAnomalies = result.anomalies || [];
        logHealthScore = result.isHealthy ? 100 : Math.max(10, 100 - (logAnomalies.length * 25));
      }

      // 3. HTTP Health Check URL pinging
      let httpHealthy = true;
      let httpAnomaly = null;
      let httpScorePenalty = 0;

      if (proj.healthCheckPath && proj.port) {
        const pathToCheck = proj.healthCheckPath.startsWith('/') ? proj.healthCheckPath : `/${proj.healthCheckPath}`;
        const checkUrl = `http://localhost:${proj.port}${pathToCheck}`;
        
        try {
          const axios = require('axios');
          const response = await axios.get(checkUrl, {
            headers: {
              'User-Agent': 'LaunchLive-SRE/1.0',
              'X-LaunchLive-Monitor': 'true'
            },
            timeout: 5000,
            validateStatus: () => true // resolve promise for all status codes
          });
          
          if (response.status < 200 || response.status >= 300) {
            httpHealthy = false;
            httpAnomaly = `HTTP check failed with status ${response.status} on ${pathToCheck}`;
            httpScorePenalty = 35;
          }
        } catch (httpErr) {
          httpHealthy = false;
          httpAnomaly = `HTTP check connection error on ${pathToCheck}: ${httpErr.message}`;
          httpScorePenalty = 50;
        }
      }

      const finalHealthScore = Math.max(10, logHealthScore - httpScorePenalty);
      const isOverallHealthy = logHealthy && httpHealthy;
      const allAnomalies = [...logAnomalies, ...(httpAnomaly ? [httpAnomaly] : [])];

      const existing = monitors.get(String(projectId)) || {};
      const previousScore = existing.lastScore ?? 100;

      // Raise health drop notification
      if (finalHealthScore < 70 && previousScore >= 70) {
        try {
          const Notification = require('../models/Notification.model');
          const { emitNotification } = require('../sockets/logs.socket');
          const notif = await Notification.create({
            user: proj.owner,
            title: `⚠️ Container Health Drop: ${proj.name}`,
            message: `Container health score dropped to ${finalHealthScore}% due to: ${allAnomalies.slice(0, 3).join(', ') || 'runtime health anomalies'}.`,
            type: 'warning',
            project: proj._id,
          });
          emitNotification(proj.owner.toString(), notif);
        } catch (notifErr) {
          console.error('[HealthMonitor] Failed to create drop notification:', notifErr.message);
        }
      }

      // Track consecutive failures
      let consecutiveFailures = existing.consecutiveFailures || 0;
      if (finalHealthScore < 30) {
        consecutiveFailures += 1;
      } else {
        consecutiveFailures = 0;
      }

      monitors.set(String(projectId), {
        ...existing,
        intervalId,
        lastScore: finalHealthScore,
        lastCheckedAt: new Date(),
        anomalies: allAnomalies,
        isHealthy: isOverallHealthy,
        consecutiveFailures,
      });

      // ── Persist score to DB on every monitoring tick ──────────────────────────
      try {
        await Project.findByIdAndUpdate(projectId, { lastHealthScore: finalHealthScore });
        await notifyUpdate(projectId);
      } catch (dbErr) {
        console.warn(`[HealthMonitor] DB persist failed for ${projectId}:`, dbErr.message);
      }

      // ── Auto-recovery: restart container if critically unhealthy ──────────────
      if (finalHealthScore < 30 && currentContainerId) {
        const prevRecovery = existing.lastRecoveryAt;
        const now = Date.now();
        const isGracePeriod = prevRecovery && (now - new Date(prevRecovery).getTime()) < 60 * 1000;

        if (isGracePeriod) {
          console.log(`[HealthMonitor] Project ${projectId} is inside the 60s recovery grace period. Skipping restart check.`);
        } else if (consecutiveFailures >= 3) {
          // Only attempt recovery once every 5 minutes to avoid restart loops
          if (!prevRecovery || (now - new Date(prevRecovery).getTime()) > 5 * 60 * 1000) {
            console.warn(`[HealthMonitor] 🔴 Critical health (${finalHealthScore}) for project ${projectId} after ${consecutiveFailures} consecutive failures. Auto-restarting container...`);
            try {
              await restartContainer(currentContainerId);
              console.log(`[HealthMonitor] ✅ Container ${currentContainerId} restarted successfully.`);
              
              try {
                const Notification = require('../models/Notification.model');
                const { emitNotification } = require('../sockets/logs.socket');
                const notif = await Notification.create({
                  user: proj.owner,
                  title: `🔄 Auto-Restart Initiated: ${proj.name}`,
                  message: `LaunchLive SRE auto-restarted the container for ${proj.name} due to critical health score (${finalHealthScore}%).`,
                  type: 'warning',
                  project: proj._id,
                });
                emitNotification(proj.owner.toString(), notif);
              } catch (notifErr) {
                console.error('[HealthMonitor] Failed to create restart notification:', notifErr.message);
              }

              monitors.set(String(projectId), {
                ...monitors.get(String(projectId)) || {},
                lastRecoveryAt: new Date(),
                lastScore: 60,
                isHealthy: true,
                anomalies: [],
                consecutiveFailures: 0,
              });

              // Update DB to reflect recovery attempt
              try {
                await Project.findByIdAndUpdate(projectId, { lastHealthScore: 60, status: 'live' });
                await notifyUpdate(projectId);
              } catch {}
            } catch (restartErr) {
              console.error(`[HealthMonitor] ❌ Container restart failed for ${currentContainerId}:`, restartErr.message);
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[HealthMonitor] Error monitoring project ${projectId}:`, err.message);
    }
  }, 90_000); // 90 seconds

  monitors.set(String(projectId), { intervalId, lastScore: 100, anomalies: [], isHealthy: true, lastCheckedAt: null, consecutiveFailures: 0 });
}

function stopMonitoring(projectId) {
  const existing = monitors.get(String(projectId));
  if (existing?.intervalId) {
    clearInterval(existing.intervalId);
    monitors.delete(String(projectId));
  }
}

function getHealthStatus(projectId) {
  const status = monitors.get(String(projectId));
  if (!status) return { monitored: false, lastScore: 100, anomalies: [], isHealthy: true, lastCheckedAt: null };
  return {
    monitored: true,
    lastScore: status.lastScore ?? 100,
    anomalies: status.anomalies || [],
    isHealthy: status.isHealthy !== false,
    lastCheckedAt: status.lastCheckedAt,
    lastRecoveryAt: status.lastRecoveryAt || null,
  };
}

function acknowledgeAlert(projectId) {
  const existing = monitors.get(String(projectId));
  if (existing) {
    monitors.set(String(projectId), { ...existing, anomalies: [], lastScore: 100, isHealthy: true });
    notifyUpdate(projectId).catch(() => {});
  }
}

async function notifyUpdate(projectId) {
  try {
    const Project = require('../models/Project.model');
    const Deployment = require('../models/Deployment.model');
    const { emitProjectUpdate } = require('../sockets/logs.socket');
    const project = await Project.findById(projectId);
    const deployments = await Deployment.find({ project: projectId }).sort({ createdAt: -1 }).limit(10);
    emitProjectUpdate(String(projectId), { project, deployments });
  } catch (err) {
    console.warn(`[HealthMonitor] Socket notify failed for ${projectId}:`, err.message);
  }
}

module.exports = { startMonitoring, stopMonitoring, getHealthStatus, acknowledgeAlert };
