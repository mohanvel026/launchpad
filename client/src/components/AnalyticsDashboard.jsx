import { useEffect, useState } from 'react';
import api from '../lib/api';

function BarChart({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.visits), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '8px', height: '120px', padding: '20px 0' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          <div style={{
            width: '100%',
            height: `${Math.max((d.visits / max) * 100, 4)}px`,
            background: d.visits > 0 ? 'var(--accent-primary)' : 'rgba(255,255,255,0.05)',
            borderRadius: '4px 4px 0 0',
            transition: 'height 0.5s ease-out',
            boxShadow: d.visits > 0 ? '0 0 15px rgba(56, 189, 248, 0.3)' : 'none'
          }} />
          <div style={{ fontSize: '10px', color: 'var(--text-dim)', whiteSpace: 'nowrap', fontWeight: 600 }}>
            {d.date.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, color = 'var(--accent-primary)' }) {
  return (
    <div className="lp-card glass" style={{ padding: '24px' }}>
      <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{label}</div>
      <div style={{ fontSize: '32px', fontWeight: 800, color }}>{value}</div>
      {sub && <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>{sub}</div>}
    </div>
  );
}

export default function AnalyticsDashboard({ projectId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/analytics/${projectId}`)
      .then((r) => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [projectId]);

  const handleReset = async () => {
    if (!window.confirm('Reset all analytics for this project? This action is irreversible.')) return;
    await api.delete(`/analytics/${projectId}/reset`);
    setData((prev) => ({ 
      ...prev, 
      analytics: { 
        totalVisits: 0, 
        totalErrors: 0, 
        avgResponseTime: 0, 
        days: prev.analytics.days.map((d) => ({ ...d, visits: 0, errors: 0 })) 
      } 
    }));
  };

  if (loading) return (
    <div className="flex-center" style={{ padding: '100px 0' }}>
      <div className="loading-spinner" style={{ width: 32, height: 32 }}></div>
    </div>
  );

  const a = data?.analytics;
  const errorRate = a?.totalVisits > 0
    ? ((a.totalErrors / a.totalVisits) * 100).toFixed(1)
    : '0.0';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Stats Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 24 }}>
        <StatCard label="Total Traffic"      value={a?.totalVisits?.toLocaleString() || 0}    color="var(--accent-primary)" />
        <StatCard label="Response Latency"   value={`${a?.avgResponseTime || 0}ms`}            color="var(--accent-secondary)" sub="Network Average" />
        <StatCard label="Error Threshold"    value={`${errorRate}%`}                           color={parseFloat(errorRate) > 5 ? 'var(--accent-danger)' : 'var(--accent-success)'} />
        <StatCard label="Critical Errors"    value={a?.totalErrors || 0}                       color="var(--accent-danger)" />
      </div>

      {/* Traffic Flow Chart */}
      <div className="lp-card glass" style={{ padding: 32 }}>
        <div className="flex-between" style={{ marginBottom: 32 }}>
          <div>
            <h3 style={{ margin: 0 }}>Traffic Distribution</h3>
            <p className="text-muted" style={{ margin: '4px 0 0' }}>7-day rolling request window</p>
          </div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-primary)', background: 'rgba(56, 189, 248, 0.1)', padding: '6px 16px', borderRadius: 100 }}>
            {a?.days?.reduce((s, d) => s + d.visits, 0) || 0} Total Requests
          </div>
        </div>
        <BarChart data={a?.days || []} />
      </div>

      {/* Analytics Meta Info */}
      <div className="glass" style={{ padding: 24, borderRadius: 16, borderLeft: '4px solid var(--accent-primary)' }}>
        <div style={{ fontSize: 14, lineHeight: '1.6', color: 'var(--text-main)' }}>
          <strong>Edge Analytics Protocol:</strong> Visits are recorded in real-time as they pass through the LaunchPad edge proxy. 
          Data integrity is maintained using Redis-backed hyperloglog counters for high performance.
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleReset} className="lp-btn-secondary" style={{ color: 'var(--accent-danger)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
          Wipe Analytics History
        </button>
      </div>
    </div>
  );
}