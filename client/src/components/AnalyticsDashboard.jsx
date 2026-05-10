import { useEffect, useState } from 'react';
import api from '../lib/api';

// Mini bar chart using pure CSS/SVG
function BarChart({ data }) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.visits), 1);
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '60px' }}>
      {data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
          <div style={{
            width: '100%',
            height: `${Math.max((d.visits / max) * 52, 2)}px`,
            background: d.visits > 0 ? '#0070f3' : '#e2e8f0',
            borderRadius: '3px 3px 0 0',
            transition: 'height 0.3s',
          }} />
          <div style={{ fontSize: '9px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
            {d.date.slice(5)}
          </div>
        </div>
      ))}
    </div>
  );
}

function StatCard({ label, value, sub, color = '#0070f3' }) {
  return (
    <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1rem 1.2rem', background: '#fff' }}>
      <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '6px' }}>{label}</div>
      <div style={{ fontSize: '26px', fontWeight: '700', color }}>{value}</div>
      {sub && <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>{sub}</div>}
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
    if (!window.confirm('Reset all analytics for this project?')) return;
    await api.delete(`/analytics/${projectId}/reset`);
    setData((prev) => ({ ...prev, analytics: { totalVisits: 0, totalErrors: 0, avgResponseTime: 0, days: prev.analytics.days.map((d) => ({ ...d, visits: 0, errors: 0 })) } }));
  };

  if (loading) return <p style={{ color: '#94a3b8', fontSize: '14px' }}>Loading analytics…</p>;

  const a = data?.analytics;
  const errorRate = a?.totalVisits > 0
    ? ((a.totalErrors / a.totalVisits) * 100).toFixed(1)
    : '0.0';

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>

      {/* Stats grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '12px', marginBottom: '1.5rem' }}>
        <StatCard label="Total Visits"      value={a?.totalVisits?.toLocaleString() || 0}    color="#0070f3" />
        <StatCard label="Avg Response Time" value={`${a?.avgResponseTime || 0}ms`}            color="#8b5cf6" sub="lower is better" />
        <StatCard label="Error Rate"        value={`${errorRate}%`}                           color={parseFloat(errorRate) > 5 ? '#f43f5e' : '#22c55e'} />
        <StatCard label="Total Errors"      value={a?.totalErrors || 0}                       color="#f59e0b" />
      </div>

      {/* 7-day chart */}
      <div style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.2rem', marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ fontSize: '13px', fontWeight: '500' }}>Visits — Last 7 Days</div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            Total: {a?.days?.reduce((s, d) => s + d.visits, 0) || 0} visits
          </div>
        </div>
        <BarChart data={a?.days || []} />
      </div>

      {/* Note about analytics */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.6' }}>
          <strong>How analytics work:</strong> Visits are tracked when users access your deployed app through the LaunchPad reverse proxy.
          Analytics data is stored in Redis and kept for 30 days.
        </div>
      </div>

      <button onClick={handleReset}
        style={{ fontSize: '12px', padding: '6px 14px', border: '1px solid #fca5a5', borderRadius: '8px', cursor: 'pointer', background: '#fff1f2', color: '#b91c1c' }}>
        Reset Analytics
      </button>
    </div>
  );
}