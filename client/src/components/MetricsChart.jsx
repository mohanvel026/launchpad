import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../lib/api';

function Bar({ value, max, color }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ background: 'rgba(255,255,255,0.05)', borderRadius: '6px', height: '10px', width: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '6px', transition: 'width 0.5s ease-out' }} />
    </div>
  );
}

function Sparkline({ data, color, height = 60 }) {
  if (!data || data.length < 2) return null;
  const max    = Math.max(...data, 1);
  const width  = 400;
  const points = data.slice(-40).map((v, i, arr) => {
    const x = (i / (arr.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`grad-${color}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`M0,${height} L${points} L${width},${height} Z`} fill={`url(#grad-${color})`} />
      <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export default function MetricsChart({ projectId, socketRef }) {
  const [live,    setLive]    = useState(null);
  const [history, setHistory] = useState([]);
  const [project, setProject] = useState(null);
  const localSocketRef = useRef(null);

  // AI Health Telemetry monitor states
  const [healthStatus, setHealthStatus] = useState(null);
  const [loadingHealth, setLoadingHealth] = useState(false);

  const fetchHealthStatus = async () => {
    try {
      const res = await api.get(`/health/${projectId}`);
      setHealthStatus(res.data);
    } catch (err) {
      console.error('[MetricsChart] Error fetching health status:', err);
    }
  };

  const handleAckAlerts = async () => {
    setLoadingHealth(true);
    try {
      await api.post(`/health/${projectId}/ack`);
      await fetchHealthStatus();
    } catch (err) {
      console.error('[MetricsChart] Error acknowledging alerts:', err);
    } finally {
      setLoadingHealth(false);
    }
  };

  useEffect(() => {
    setTimeout(() => {
      fetchHealthStatus();
    }, 0);
    const interval = setInterval(fetchHealthStatus, 20000); // Poll health status every 20s
    return () => clearInterval(interval);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    api.get(`/projects/${projectId}`)
      .then((r) => setProject(r.data.project))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    api.get(`/metrics/${projectId}/history`)
      .then((r) => setHistory(r.data.history || []))
      .catch(() => {});
  }, [projectId]);

  useEffect(() => {
    let activeSocket = socketRef?.current;
    let createdLocal = false;

    if (!activeSocket) {
      activeSocket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000');
      createdLocal = true;
    }

    activeSocket.emit('join:metrics', projectId);

    const handleMetricsUpdate = (stats) => {
      setLive(stats);
      setHistory((prev) => [...prev.slice(-59), stats]);
    };

    activeSocket.on('metrics', handleMetricsUpdate);
    localSocketRef.current = activeSocket;

    return () => {
      activeSocket.emit('leave:metrics', projectId);
      activeSocket.off('metrics', handleMetricsUpdate);
      if (createdLocal) {
        activeSocket.disconnect();
      }
    };
  }, [projectId, socketRef]);

  const stats   = live || history[history.length - 1];
  const cpuHist = history.map((h) => h.cpu    || 0);
  const memHist = history.map((h) => h.memPct || 0);

  if (!stats) {
    return (
      <div className="lp-card glass" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <div className="loading-spinner" style={{ width: 32, height: 32, margin: '0 auto 16px' }}></div>
        Awaiting telemetry data from production instance...
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: 24 }}>
      
      {/* 🧠 AI Runtime Health Telemetry (Full Width) */}
      {healthStatus && (
        <div className="lp-card glass" style={{ gridColumn: '1 / -1', padding: 32, borderLeft: '4px solid var(--accent-primary)', background: 'linear-gradient(135deg, rgba(56,189,248,0.04) 0%, rgba(129,140,248,0.01) 100%)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
            <div>
              <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10, fontSize: 18 }}>
                🧠 AI Runtime Health Telemetry
              </h3>
              <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
                Continuous logs and container anomaly scanning with automated remediation.
              </p>
            </div>
            
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ padding: '6px 16px', borderRadius: 30, background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Health Score:</span>
                <span style={{ fontSize: 14, fontWeight: 800, color: healthStatus.lastScore >= 80 ? '#10b981' : healthStatus.lastScore >= 50 ? '#fbbf24' : '#ef4444' }}>
                  {healthStatus.lastScore ?? 100} / 100
                </span>
              </div>
              <div style={{ padding: '6px 16px', borderRadius: 30, background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.05)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: healthStatus.isHealthy ? '#10b981' : '#ef4444', boxShadow: `0 0 6px ${healthStatus.isHealthy ? '#10b981' : '#ef4444'}` }}></span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>
                  {healthStatus.isHealthy ? 'HEALTHY' : 'ANOMALY DETECTED'}
                </span>
              </div>
            </div>
          </div>

          {/* Anomalies and alerts list */}
          {healthStatus.anomalies && healthStatus.anomalies.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(239, 68, 68, 0.03)', border: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ fontSize: 13, color: '#ef4444', fontWeight: 600 }}>
                  ⚠️ {healthStatus.anomalies.length} runtime anomaly/anomalies detected! Auto-recovery cooldown active.
                </div>
                <button className="lp-btn-secondary" style={{ padding: '6px 14px', fontSize: 12, color: 'var(--text-main)', border: '1px solid rgba(255, 255, 255, 0.1)', background: 'transparent', height: 'auto', width: 'auto' }} onClick={handleAckAlerts} disabled={loadingHealth}>
                  {loadingHealth ? 'Clearing...' : '✓ Acknowledge & Clear Alerts'}
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
                {healthStatus.anomalies.map((a, idx) => (
                  <div key={idx} className="glass" style={{ padding: 18, borderRadius: 12, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 800, padding: '2px 8px', borderRadius: 4, background: a.severity === 'critical' ? 'rgba(239,68,68,0.15)' : 'rgba(245,158,11,0.15)', color: a.severity === 'critical' ? '#ef4444' : '#fbbf24' }}>
                        {a.type || 'Anomaly'}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{a.severity?.toUpperCase()}</span>
                    </div>
                    <p style={{ margin: '0 0 12px 0', fontSize: 13, color: 'var(--text-main)', lineHeight: 1.5 }}>{a.message}</p>
                    {a.fix && (
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 10 }}>
                        <strong style={{ color: 'var(--accent-primary)' }}>AI Fix:</strong> {a.fix}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '14px 20px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.02)', border: '1px solid rgba(16, 185, 129, 0.15)', fontSize: 13, color: '#10b981' }}>
              <span>✓</span> AI Continuous Health Scan is running. No runtime anomalies or errors detected in the last 90 seconds.
            </div>
          )}
        </div>
      )}

      {/* CPU Usage */}
      <div className="lp-card glass" style={{ padding: 32 }}>
        <div className="flex-between" style={{ marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Processor Load</div>
            <div style={{ fontSize: 36, fontWeight: 800, marginTop: 4 }}>
              {stats.cpu?.toFixed(1)}% <span style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 500 }}>/ {project?.cpuLimit || 0.5} CPU limit</span>
            </div>
          </div>
          <div style={{ width: 48, height: 48, background: 'rgba(56, 189, 248, 0.1)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6v6H9z"/><path d="M15 2v2"/><path d="M9 2v2"/><path d="M20 15h2"/><path d="M20 9h2"/><path d="M15 20v2"/><path d="M9 20v2"/><path d="M2 15h2"/><path d="M2 9h2"/></svg>
          </div>
        </div>
        <Bar value={stats.cpu} max={100} color="var(--accent-primary)" />
        <div style={{ marginTop: 32 }}>
          <Sparkline data={cpuHist} color="var(--accent-primary)" />
        </div>
      </div>

      {/* Memory Usage */}
      <div className="lp-card glass" style={{ padding: 32 }}>
        <div className="flex-between" style={{ marginBottom: 24 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Memory Consumption</div>
            <div style={{ fontSize: 36, fontWeight: 800, marginTop: 4 }}>
              {stats.memMB} MB <span style={{ fontSize: 14, color: 'var(--text-dim)', fontWeight: 500 }}>/ {project?.ramLimitMB || 512} MB limit</span>
            </div>
          </div>
          <div style={{ width: 48, height: 48, background: 'rgba(129, 140, 248, 0.1)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--accent-secondary)" strokeWidth="2"><path d="M6 19v2"/><path d="M10 19v2"/><path d="M14 19v2"/><path d="M18 19v2"/><path d="M8 11V9"/><path d="M16 11V9"/><path d="M12 11V9"/><path d="M2 15h20"/><path d="M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7Z"/></svg>
          </div>
        </div>
        <Bar value={stats.memPct} max={100} color="var(--accent-secondary)" />
        <div style={{ marginTop: 32 }}>
          <Sparkline data={memHist} color="var(--accent-secondary)" />
        </div>
      </div>

      {/* Instance Health */}
      <div className="lp-card glass" style={{ gridColumn: '1 / -1', padding: 32 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 24 }}>Traffic & Health</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 32 }}>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Network Ingress</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.rxMB || 0} MB</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Network Egress</div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{stats.txMB || 0} MB</div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Active Resource Allocation</div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
              ⚙️ {project?.cpuLimit || 0.5} CPU / {project?.ramLimitMB || 512}MB RAM
            </div>
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginBottom: 4 }}>Runtime Status</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 16, fontWeight: 700, color: stats.status === 'running' ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 8px currentColor' }}></div>
              {stats.status?.toUpperCase()}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}