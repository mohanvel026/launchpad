import { useEffect, useState } from 'react';
import api from '../lib/api';

// Format standard text message paragraphs and simple bold marks inside Analytics reports
function formatMessageContent(content) {
  if (typeof content !== 'string') return content;
  const parts = content.split(/(```[\s\S]*?```)/g);

  return parts.map((part, index) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const language = match ? match[1] : '';
      const code = match ? match[2].trim() : part.slice(3, -3).trim();

      return (
        <div key={index} style={{
          background: '#09090e',
          border: '1px solid rgba(255, 255, 255, 0.05)',
          borderRadius: '8px',
          margin: '12px 0',
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: '13px',
          overflow: 'hidden',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)',
          textAlign: 'left'
        }}>
          {language && (
            <div style={{
              background: 'rgba(255, 255, 255, 0.02)',
              borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
              padding: '6px 12px',
              fontSize: '11px',
              color: 'var(--text-dim)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              fontWeight: 700
            }}>
              {language}
            </div>
          )}
          <pre style={{ margin: 0, padding: '12px', overflowX: 'auto', color: '#e2e8f0', lineHeight: 1.5 }}>
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    const lines = part.split('\n');
    return lines.map((partLine, lineIndex) => {
      const tokens = partLine.split(/(\*\*.*?\*\*|`.*?`)/g);
      const parsedLine = tokens.map((token, tokenIndex) => {
        if (token.startsWith('**') && token.endsWith('**')) {
          return <strong key={tokenIndex} style={{ color: 'var(--text-main)', fontWeight: 700 }}>{token.slice(2, -2)}</strong>;
        }
        if (token.startsWith('`') && token.endsWith('`')) {
          return (
            <code key={tokenIndex} style={{
              fontFamily: 'var(--font-mono, monospace)',
              background: 'rgba(255, 255, 255, 0.08)',
              color: '#38bdf8',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '12.5px',
              border: '1px solid rgba(255, 255, 255, 0.04)'
            }}>
              {token.slice(1, -1)}
            </code>
          );
        }
        return token;
      });

      return (
        <div key={`${index}-${lineIndex}`} style={{ minHeight: '1.2em', marginBottom: lineIndex < lines.length - 1 ? '8px' : 0 }}>
          {parsedLine}
        </div>
      );
    });
  });
}

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
  const [aiReport, setAiReport] = useState('');
  const [generatingAi, setGeneratingAi] = useState(false);

  useEffect(() => {
    const loadData = () => {
      api.get(`/analytics/${projectId}`)
        .then((r) => setData(r.data))
        .catch(() => {})
        .finally(() => setLoading(false));
    };
    loadData();
    const interval = setInterval(loadData, 5000); // 5-second live polling
    return () => clearInterval(interval);
  }, [projectId]);

  const handleGenerateAI = async () => {
    setGeneratingAi(true);
    try {
      const res = await api.post(`/ai/${projectId}/traffic-insights`);
      setAiReport(res.data.reply);
    } catch (e) {
      alert('Failed to generate SRE traffic insights: ' + (e.response?.data?.message || e.message));
    } finally {
      setGeneratingAi(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Reset all analytics for this project? This action is irreversible.')) return;
    await api.delete(`/analytics/${projectId}/reset`);
    setData((prev) => ({ 
      ...prev, 
      analytics: { 
        totalVisits: 0, 
        totalErrors: 0, 
        avgResponseTime: 0, 
        days: prev.analytics.days.map((d) => ({ ...d, visits: 0, errors: 0 })),
        logs: [],
        routes: []
      } 
    }));
  };

  if (loading && !data) return (
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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 24 }}>
        <StatCard label="Total Traffic"      value={a?.totalVisits?.toLocaleString() || 0}    color="var(--accent-primary)" />
        <StatCard label="Response Latency"   value={`${a?.avgResponseTime || 0}ms`}            color="var(--accent-secondary)" sub="Network Average" />
        <StatCard label="Service Uptime"     value={a?.uptime || '100%'}                       color="#10b981" sub="From deploy history" />
        <StatCard label="Error Threshold"    value={`${errorRate}%`}                           color={parseFloat(errorRate) > 5 ? 'var(--accent-danger)' : 'var(--accent-success)'} />
        <StatCard label="Critical Errors"    value={a?.totalErrors || 0}                       color="var(--accent-danger)" />
      </div>

      {/* ── AI Edge Traffic Auditor Card ── */}
      <div className="lp-card glass" style={{ 
        padding: 32, 
        borderLeft: '4px solid var(--accent-primary)',
        background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.02) 100%)'
      }}>
        <div className="flex-between" style={{ gap: 24, flexWrap: 'wrap' }}>
          <div>
            <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
              🧠 AI Traffic & Security Auditor
            </h3>
            <p className="text-muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
              Audit your edge proxy traffic distributions, request latencies, and scan for malicious DDoS or IP access anomalies using LaunchLive SRE AI.
            </p>
          </div>
          <button 
            onClick={handleGenerateAI} 
            disabled={generatingAi} 
            className="lp-btn-primary" 
            style={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 8, 
              padding: '12px 24px', 
              whiteSpace: 'nowrap',
              boxShadow: '0 0 20px rgba(56, 189, 248, 0.2)'
            }}
          >
            {generatingAi ? (
              <>
                <div className="loading-spinner" style={{ width: 16, height: 16, borderColor: '#fff', borderTopColor: 'transparent' }} />
                Auditing Traffic Patterns...
              </>
            ) : (
              <>🤖 Generate AI SRE Traffic Audit</>
            )}
          </button>
        </div>

        {aiReport && (
          <div className="fade-in" style={{ 
            marginTop: 28, 
            padding: 24, 
            background: 'rgba(0,0,0,0.2)', 
            borderRadius: 12, 
            border: '1px solid rgba(255,255,255,0.05)',
            fontSize: 14,
            lineHeight: '1.7',
            color: '#e2e8f0'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 12 }}>
              <strong style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--accent-primary)' }}>
                🛡️ AI Edge Traffic Insights Report
              </strong>
              <button 
                onClick={() => setAiReport('')} 
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
              >
                Clear Report
              </button>
            </div>
            {formatMessageContent(aiReport)}
          </div>
        )}
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

      {/* Two Column Grid: Popular Endpoints & Live Log Stream */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: 24 }}>
        
        {/* Popular Endpoints Column */}
        <div className="lp-card glass" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ margin: 0, fontSize: 16 }}>Popular Endpoints</h4>
            <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 12 }}>Most requested routing paths</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
            {!a?.routes || a.routes.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0', fontSize: 13, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                No routing hits recorded yet.
              </div>
            ) : (
              a.routes.map((r, i) => (
                <div key={i} className="flex-between" style={{ padding: '8px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 8, border: '1px solid rgba(255,255,255,0.03)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ 
                      fontSize: 10, 
                      fontWeight: 800, 
                      padding: '2px 6px', 
                      borderRadius: 4, 
                      background: r.method === 'POST' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(56, 189, 248, 0.2)',
                      color: r.method === 'POST' ? '#c084fc' : '#38bdf8'
                    }}>
                      {r.method}
                    </span>
                    <span style={{ fontSize: 13, fontWeight: 600, fontFamily: 'monospace', color: 'var(--text-main)' }}>
                      {r.path}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>
                    {r.hits} hit{r.hits !== 1 && 's'}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Live Ingress Stream Column */}
        <div className="lp-card glass" style={{ padding: 24, display: 'flex', flexDirection: 'column' }}>
          <div style={{ marginBottom: 20 }}>
            <h4 style={{ margin: 0, fontSize: 16 }}>Live Edge Access Logs</h4>
            <p className="text-muted" style={{ margin: '2px 0 0', fontSize: 12 }}>Real-time edge proxy requests stream</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 350, overflowY: 'auto', paddingRight: 4 }}>
            {!a?.logs || a.logs.length === 0 ? (
              <div style={{ color: 'var(--text-dim)', textAlign: 'center', padding: '40px 0', fontSize: 13, flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                Awaiting incoming requests...
              </div>
            ) : (
              a.logs.map((log, i) => {
                const isErr = log.statusCode >= 400;
                return (
                  <div key={i} style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    justifyContent: 'space-between',
                    padding: '8px 12px', 
                    background: 'rgba(255,255,255,0.01)', 
                    borderRadius: 8, 
                    borderLeft: `3px solid ${isErr ? 'var(--accent-danger)' : 'var(--accent-success)'}` 
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                      <span style={{ 
                        fontSize: 10, 
                        fontWeight: 800, 
                        color: isErr ? 'var(--accent-danger)' : 'var(--accent-success)' 
                      }}>
                        {log.statusCode}
                      </span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase' }}>
                        {log.method}
                      </span>
                      <span style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--text-main)', textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap', maxWidth: 160 }} title={log.url}>
                        {log.url}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-dim)' }}>
                      <span>⚡ {log.responseTime}ms</span>
                      <span style={{ fontFamily: 'monospace', fontSize: 10 }}>({log.ip})</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

      </div>

      {/* Analytics Meta Info */}
      <div className="glass" style={{ padding: 24, borderRadius: 16, borderLeft: '4px solid var(--accent-primary)' }}>
        <div style={{ fontSize: 14, lineHeight: '1.6', color: 'var(--text-main)' }}>
          <strong>Edge Analytics Protocol:</strong> Visits are recorded in real-time as they pass through the LaunchLive edge proxy. 
          Data integrity is maintained using Redis-backed hyperloglog counters and sliding lists for high performance.
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