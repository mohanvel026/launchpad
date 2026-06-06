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
  const { _id: projectId, containerId, stack } = project;
  if (!containerId || containerId === 'local-static') return;

  // Stop existing monitor if any
  stopMonitoring(projectId);

  const intervalId = setInterval(async () => {
    try {
      const logsCmd = `docker logs --tail 200 --since 90s ${containerId} 2>&1`;
      let logs = '';
      try {
        logs = execSync(logsCmd, { timeout: 8000 }).toString();
      } catch (e) {
        logs = e.stdout?.toString() || e.stderr?.toString() || '';
      }

      if (!logs.trim()) return; // Nothing to analyze

      const result = await inspectRuntimeLogs(logs, stack || 'unknown');
      const healthScore = result.isHealthy ? 100 : Math.max(10, 100 - (result.anomalies.length * 25));

      const existing = monitors.get(String(projectId)) || {};
      monitors.set(String(projectId), {
        ...existing,
        intervalId,
        lastScore: healthScore,
        lastCheckedAt: new Date(),
        anomalies: result.anomalies || [],
        isHealthy: result.isHealthy,
      });

      // ── Persist score to DB on every monitoring tick ──────────────────────────
      try {
        const Project = require('../models/Project.model');
        await Project.findByIdAndUpdate(projectId, { lastHealthScore: healthScore });
      } catch (dbErr) {
        console.warn(`[HealthMonitor] DB persist failed for ${projectId}:`, dbErr.message);
      }

      // ── Auto-recovery: restart container if critically unhealthy ──────────────
      if (healthScore < 30 && containerId) {
        const prevRecovery = existing.lastRecoveryAt;
        const now = Date.now();
        // Only attempt recovery once every 5 minutes to avoid restart loops
        if (!prevRecovery || (now - new Date(prevRecovery).getTime()) > 5 * 60 * 1000) {
          console.warn(`[HealthMonitor] 🔴 Critical health (${healthScore}) for project ${projectId}. Auto-restarting container...`);
          try {
            await restartContainer(containerId);
            console.log(`[HealthMonitor] ✅ Container ${containerId} restarted successfully.`);
            monitors.set(String(projectId), {
              ...monitors.get(String(projectId)) || {},
              lastRecoveryAt: new Date(),
              lastScore: 60,
              isHealthy: true,
              anomalies: [],
            });
            // Update DB to reflect recovery attempt
            try {
              const Project = require('../models/Project.model');
              await Project.findByIdAndUpdate(projectId, { lastHealthScore: 60 });
            } catch {}
          } catch (restartErr) {
            console.error(`[HealthMonitor] ❌ Container restart failed for ${containerId}:`, restartErr.message);
          }
        }
      }
    } catch (err) {
      console.warn(`[HealthMonitor] Error monitoring project ${projectId}:`, err.message);
    }
  }, 90_000); // 90 seconds

  monitors.set(String(projectId), { intervalId, lastScore: 100, anomalies: [], isHealthy: true, lastCheckedAt: null });
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
  }
}

module.exports = { startMonitoring, stopMonitoring, getHealthStatus, acknowledgeAlert };
