import { useState, useRef, useEffect } from 'react';
import api from '../lib/api';

// Format standard text message paragraphs and simple bold marks
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
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4)'
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

// ─── 1. Security Vulnerability Scan SRE Panel ───
function SecurityReportWidget({ data }) {
  const [expanded, setExpanded] = useState({});
  const score = data.securityScore || 100;
  const grade = data.securityGrade || 'A+';
  const issues = data.issues || [];
  const recs = data.recommendations || [];

  const gradeColor = score >= 90 ? '#10b981' : score >= 75 ? '#fbbf24' : '#ef4444';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
      {/* Visual Ring and Score */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: 16, borderRadius: 12, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)' }}>
        <div style={{ position: 'relative', width: 68, height: 68, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="68" height="68" viewBox="0 0 36 36">
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="3" />
            <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke={gradeColor} strokeWidth="3" strokeDasharray={`${score}, 100`} strokeLinecap="round" />
          </svg>
          <div style={{ position: 'absolute', fontSize: 16, fontWeight: 800, color: '#fff' }}>{score}%</div>
        </div>
        <div>
          <div style={{ fontSize: 18, fontWeight: 800, display: 'flex', alignItems: 'center', gap: 8 }}>
            Audit Grade: <span style={{ color: gradeColor, textShadow: `0 0 10px ${gradeColor}` }}>{grade}</span>
          </div>
          <p style={{ margin: '4px 0 0 0', fontSize: 12, color: 'var(--text-dim)' }}>
            {issues.length === 0 ? '✨ Code architecture & dependencies are secure.' : `⚠️ Found ${issues.length} security flags.`}
          </p>
        </div>
      </div>

      {/* Vulnerabilities Accordion */}
      {issues.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>Vulnerabilities Details</div>
          {issues.map((i, idx) => {
            const isHigh = i.severity?.toUpperCase() === 'HIGH';
            const isMed = i.severity?.toUpperCase() === 'MEDIUM';
            const borderCol = isHigh ? 'rgba(239, 68, 68, 0.2)' : isMed ? 'rgba(251, 191, 36, 0.2)' : 'rgba(16, 185, 129, 0.2)';
            const bgCol = isHigh ? 'rgba(239, 68, 68, 0.02)' : isMed ? 'rgba(251, 191, 36, 0.02)' : 'rgba(16, 185, 129, 0.02)';
            
            return (
              <div key={idx} style={{ borderRadius: 8, border: `1px solid ${borderCol}`, background: bgCol, overflow: 'hidden' }}>
                <button
                  onClick={() => setExpanded(prev => ({ ...prev, [idx]: !prev[idx] }))}
                  style={{ width: '100%', background: 'transparent', border: 'none', padding: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', textAlign: 'left' }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: isHigh ? '#ef4444' : isMed ? '#fbbf24' : '#10b981' }}>●</span>
                    {i.title}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{expanded[idx] ? '▲' : '▼'}</span>
                </button>
                {expanded[idx] && (
                  <div style={{ padding: '0 12px 12px 12px', fontSize: 12, borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div><span style={{ color: 'var(--text-muted)' }}>Severity:</span> <code style={{ color: isHigh ? '#ef4444' : '#fbbf24' }}>{i.severity}</code></div>
                    <div><span style={{ color: 'var(--text-muted)' }}>Description:</span> <span style={{ color: 'var(--text-dim)' }}>{i.description}</span></div>
                    {i.remediation && (
                      <div style={{ marginTop: 4, padding: 8, borderRadius: 6, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>SRE Patch:</span> {i.remediation}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* SRE Recommendations */}
      {recs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: 14, borderRadius: 10, background: 'rgba(56, 189, 248, 0.02)', border: '1px solid rgba(56, 189, 248, 0.1)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 14 }}>💡</span> SRE HARDENING REMEDIATIONS
          </div>
          <ul style={{ margin: 0, paddingLeft: 16, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
            {recs.map((r, idx) => <li key={idx}>{r}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── 2. Docker & Config Optimizer SRE Panel ───
function ConfigReportWidget({ data }) {
  const suggestions = data.suggestions || [];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
      {suggestions.length === 0 ? (
        <div className="flex-center" style={{ padding: 20, borderRadius: 10, background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', color: '#10b981', fontSize: 13 }}>
          ✅ Configurations are fully optimized for active caching & concurrent delivery.
        </div>
      ) : (
        suggestions.map((s, idx) => (
          <div key={idx} style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255, 255, 255, 0.06)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>📋 Optimization #{idx + 1}</span>
              {s.impact && (
                <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 100, fontWeight: 700, background: s.impact.toUpperCase() === 'HIGH' ? 'rgba(168, 85, 247, 0.15)' : 'rgba(56, 189, 248, 0.15)', color: s.impact.toUpperCase() === 'HIGH' ? '#c084fc' : '#38bdf8' }}>
                  {s.impact} Impact
                </span>
              )}
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.5 }}>{s.suggestion || s}</p>
            {s.file && (
              <div style={{ marginTop: 8, fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>Target File:</span> <code style={{ color: 'var(--accent-primary)', background: 'rgba(255,255,255,0.03)', padding: '2px 6px', borderRadius: 4 }}>{s.file}</code>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ─── 3. REST API Docs / Playground Panel ───
function DocsReportWidget({ data }) {
  const endpoints = data.apiEndpoints || [];
  const [copied, setCopied] = useState(false);

  const copyReadme = () => {
    if (!data.readme) return;
    navigator.clipboard.writeText(data.readme);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
      {endpoints.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-muted)' }}>API Routing Playground</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
            {endpoints.map((ep, idx) => {
              const method = (ep.method || 'GET').toUpperCase();
              const methodCol = method === 'POST' ? '#10b981' : method === 'DELETE' ? '#ef4444' : method === 'PUT' ? '#fbbf24' : '#38bdf8';
              const methodBg = method === 'POST' ? 'rgba(16, 185, 129, 0.08)' : method === 'DELETE' ? 'rgba(239, 68, 68, 0.08)' : method === 'PUT' ? 'rgba(251, 191, 36, 0.08)' : 'rgba(56, 189, 248, 0.08)';

              return (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, borderRadius: 8, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <span style={{ fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: 6, color: methodCol, background: methodBg, border: `1px solid ${methodCol}22`, minWidth: 62, textAlign: 'center' }}>
                    {method}
                  </span>
                  <code style={{ fontSize: 12.5, color: '#fff', overflowX: 'auto', whiteSpace: 'nowrap', flex: 1 }}>{ep.path || ep}</code>
                  {ep.description && <span style={{ fontSize: 11, color: 'var(--text-dim)', fontStyle: 'italic', maxWidth: '40%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ep.description}</span>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.readme && (
        <div style={{ padding: 14, borderRadius: 10, background: 'rgba(0,0,0,0.15)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-success)' }}>📝 Compiled README.md</span>
            <button onClick={copyReadme} className="lp-btn-secondary" style={{ padding: '4px 10px', fontSize: 11, height: 'auto', background: 'transparent' }}>
              {copied ? '✅ Copied!' : '📋 Copy File'}
            </button>
          </div>
          <pre style={{ margin: 0, fontSize: 11.5, color: 'var(--text-dim)', background: '#050508', padding: 10, borderRadius: 6, maxHeight: 120, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.03)' }}>
            <code>{data.readme}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── 4. Database Query Indexer Panel ───
function QueriesReportWidget({ data }) {
  const recs = data.recommendations || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 12 }}>
      {recs.length === 0 ? (
        <div style={{ padding: 16, borderRadius: 10, background: 'rgba(16, 185, 129, 0.05)', border: '1px solid rgba(16, 185, 129, 0.15)', color: '#10b981', fontSize: 13 }}>
          ✅ Database query patterns look optimal. No missing indexes or collection bottlenecks detected!
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {recs.map((r, idx) => {
            const isHigh = r.speedImpact?.toUpperCase() === 'HIGH';
            const impactColor = isHigh ? '#c084fc' : '#38bdf8';

            return (
              <div key={idx} style={{ padding: 14, borderRadius: 10, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>📊 Recommendation #{idx + 1}</span>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 100, fontWeight: 700, background: isHigh ? 'rgba(168,85,247,0.15)' : 'rgba(56,189,248,0.15)', color: impactColor }}>
                    {r.speedImpact || 'MEDIUM'} IMPACT
                  </span>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
                  <div>
                    <span style={{ color: 'var(--text-muted)' }}>📁 File:</span> <code style={{ color: 'var(--accent-primary)' }}>{r.file || 'unknown'}</code>
                  </div>
                  {r.query && (
                    <div style={{ background: '#050508', padding: 8, borderRadius: 6, border: '1px solid rgba(255,255,255,0.03)' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 10, textTransform: 'uppercase', display: 'block', marginBottom: 4 }}>Query Pattern</span>
                      <code style={{ color: '#e2e8f0', fontSize: 11.5, wordBreak: 'break-all' }}>{r.query}</code>
                    </div>
                  )}
                  {r.indexAdvice && (
                    <div style={{ background: 'rgba(56,189,248,0.02)', padding: 8, borderRadius: 6, border: '1px solid rgba(56,189,248,0.1)' }}>
                      <span style={{ color: 'var(--accent-primary)', fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>⚡ Suggested Database Index</span>
                      <code style={{ color: '#fff', fontSize: 12 }}>{typeof r.indexAdvice === 'object' ? JSON.stringify(r.indexAdvice) : r.indexAdvice}</code>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── 5. Live Container Log SRE Widget ───
function LogsReportWidget({ data }) {
  const anomalies = data.anomalies || [];
  const [filter, setFilter] = useState('ALL'); // ALL, ANOMALIES

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
      {/* Visual Terminal */}
      <div style={{ borderRadius: 10, background: '#050508', border: '1px solid rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ background: 'rgba(255,255,255,0.02)', borderBottom: '1px solid rgba(255,255,255,0.04)', padding: '8px 14px', display: 'flex', justifyBetween: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }}></span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24' }}></span>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }}></span>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'monospace' }}>stdout_stream.log</span>
        </div>

        <div style={{ padding: 14, maxHeight: 180, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, fontFamily: 'monospace', fontSize: 11.5, color: '#a3a3a3', lineHeight: 1.4 }}>
          {anomalies.length === 0 ? (
            <div style={{ color: '#10b981' }}>[INFO] Active stdout container stream scan: Zero anomalies, memory leaks, or timeout flags detected. System nominal.</div>
          ) : (
            anomalies.map((a, idx) => {
              const isErr = a.level?.toUpperCase() === 'ERROR' || a.level?.toUpperCase() === 'CRITICAL';
              return (
                <div key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.02)', paddingBottom: 6 }}>
                  <span style={{ color: isErr ? '#ef4444' : '#fbbf24', fontWeight: 'bold' }}>[{a.level || 'WARN'}]</span> {a.message || a}
                  {a.suggestion && (
                    <div style={{ color: 'var(--accent-primary)', fontSize: 11, marginTop: 4, paddingLeft: 10, borderLeft: '2px solid var(--accent-primary)' }}>
                      💡 SRE Advice: {a.suggestion}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// ─── 6. AI Capacity Telemetry SRE Widget ───
function TelemetryReportWidget({ data }) {
  const alerts = data.anomalyAlerts || [];
  const advice = data.scalingAdvice || [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
      {/* Metrics Alerts Callout */}
      {alerts.length > 0 ? (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', color: '#f87171', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontWeight: 700, fontSize: 12 }}>⚠️ ACTIVE CAPACITY ALERTS</span>
          {alerts.map((a, i) => (
            <div key={i} style={{ fontSize: 11.5 }}>• {a}</div>
          ))}
        </div>
      ) : (
        <div style={{ padding: 10, borderRadius: 8, background: 'rgba(16, 185, 129, 0.08)', border: '1px solid rgba(16, 185, 129, 0.2)', color: '#34d399', fontSize: 12, fontWeight: 600 }}>
          ✅ Telemetry Scan Nominal: No active memory leaks or CPU throttling detected.
        </div>
      )}

      {/* Telemetry Analysis */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, lineHeight: 1.5, background: 'rgba(255,255,255,0.01)', padding: 12, borderRadius: 10, border: '1px solid rgba(255,255,255,0.04)' }}>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>⚡ CPU Footprint:</span> <span style={{ color: '#fff' }}>{data.cpuUsageAnalysis}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>🧠 RAM Footprint:</span> <span style={{ color: '#fff' }}>{data.ramUsageAnalysis}</span>
        </div>
        <div>
          <span style={{ color: 'var(--text-muted)' }}>📈 Traffic Forecast:</span> <span style={{ color: '#fff' }}>{data.predictedGrowth}</span>
        </div>
      </div>

      {/* Recommended Sizing Cards */}
      <div style={{ display: 'flex', gap: 12 }}>
        <div style={{ flex: 1, padding: 12, borderRadius: 8, background: 'rgba(56,189,248,0.03)', border: '1px solid rgba(56,189,248,0.1)', textAlign: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', color: 'var(--accent-primary)', display: 'block', marginBottom: 4 }}>Recommended CPU</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{data.recommendedCpu} OCPU</span>
        </div>
        <div style={{ flex: 1, padding: 12, borderRadius: 8, background: 'rgba(168,85,247,0.03)', border: '1px solid rgba(168,85,247,0.1)', textAlign: 'center' }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase', color: '#c084fc', display: 'block', marginBottom: 4 }}>Recommended RAM</span>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>{data.recommendedRam} MB</span>
        </div>
      </div>

      {/* Active Caching/Scaling Advice */}
      {advice.length > 0 && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--accent-primary)', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>💡 SRE Capacity Advice</span>
          {advice.map((adv, i) => (
            <div key={i} style={{ fontSize: 12, color: '#e2e8f0', lineHeight: 1.4 }}>{adv}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AIChat({ projectId }) {
  const [messages, setMessages] = useState([
    {
      role:    'assistant',
      content: "Deep-scanning production instance... System nominal. How can I assist with your deployment architecture today?",
    },
  ]);
  const [input,   setInput]   = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTool, setActiveTool] = useState(null);
  const bottomRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    const userMsg = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await api.post(`/ai/${projectId}/chat`, {
        message: text,
        history: messages.slice(-6),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role:    'assistant',
        content: 'Neural link temporarily unstable. Please verify your system configuration or try again in a moment.',
      }]);
    } finally {
      setLoading(false);
    }
  };
 
  const handleQuickQuestion = async (q) => {
    if (loading) return;
    const userMsg = { role: 'user', content: q };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await api.post(`/ai/${projectId}/chat`, {
        message: q,
        history: messages.slice(-6),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: res.data.reply }]);
    } catch (err) {
      setMessages((prev) => [...prev, {
        role:    'assistant',
        content: 'Neural link temporarily unstable. Please verify your system configuration or try again in a moment.',
      }]);
    } finally {
      setLoading(false);
    }
  };

  const handleSreTool = async (endpoint, toolName) => {
    if (loading) return;
    setActiveTool(toolName);
    
    // Add prompt trace
    setMessages(prev => [...prev, { role: 'user', content: `🔍 Initiate AI ${toolName}...` }]);
    setLoading(true);
    
    try {
      const res = await api.post(`/ai/${projectId}/${endpoint}`);
      setMessages(prev => [
        ...prev, 
        { 
          role: 'assistant', 
          content: `📊 **AI ${toolName} completed.** Diagnostic dashboard instantiated below.`, 
          sreReport: { type: endpoint, data: res.data } 
        }
      ]);
    } catch (err) {
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ **AI ${toolName} failed:** ${err.response?.data?.message || err.message}` }]);
    } finally {
      setLoading(false);
      setActiveTool(null);
    }
  };

  const quickQuestions = [
    'Analyze last build failure',
    'Optimize for MongoDB',
    'Setup custom domain',
    'Performance audit',
  ];

  const sreTools = [
    { id: 'audit-security', name: 'Security Vulnerability Scan', icon: '🛡️', desc: 'Audit packages, ENV secrets, and dependencies for CVE threats.' },
    { id: 'optimize-config', name: 'Docker & Config Optimizer', icon: '⚙️', desc: 'Scan and rewrite Dockerfile for caching and concurrency.' },
    { id: 'generate-docs', name: 'Generate REST API Docs', icon: '📝', desc: 'Parse Express/Node routes and write a standard README.md.' },
    { id: 'optimize-queries', name: 'Database Query Indexer', icon: '📊', desc: 'Audit schema/models and suggest high-speed index strategies.' },
    { id: 'inspect-logs', name: 'Live Container Log SRE', icon: '🩺', desc: 'Audit running stdout logs for hidden memory leaks and timeouts.' },
    { id: 'predict-resources', name: 'AI Capacity Telemetry SRE', icon: '📈', desc: 'Audit live RAM/CPU telemetry metrics and predict scaling requirements.' },
  ];

  return (
    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', alignItems: 'stretch' }}>
      {/* Interactive Chat Console (2/3 width) */}
      <div className="lp-card glass" style={{ flex: '2 1 600px', display: 'flex', flexDirection: 'column', height: '650px', padding: 0, overflow: 'hidden' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.02)' }}>
          <div className="animate-pulse-cyan" style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-primary)' }}></div>
          <span style={{ fontWeight: 700, fontSize: 14, letterSpacing: '0.05em' }}>AI CO-PILOT TERMINAL</span>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {messages.map((msg, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start' }}>
              <div className={msg.role === 'user' ? 'glass' : ''} style={{
                maxWidth: '85%',
                padding: '12px 18px',
                borderRadius: 16,
                background: msg.role === 'user' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.03)',
                color: msg.role === 'user' ? '#fff' : 'var(--text-main)',
                fontSize: '14px',
                lineHeight: '1.6',
                boxShadow: msg.role === 'user' ? '0 8px 24px rgba(56, 189, 248, 0.2)' : 'none',
                border: msg.role === 'user' ? 'none' : '1px solid var(--border)'
              }}>
                {formatMessageContent(msg.content)}
                
                {/* Visual SRE Custom Interactive Widgets */}
                {msg.sreReport && msg.sreReport.type === 'audit-security' && <SecurityReportWidget data={msg.sreReport.data} />}
                {msg.sreReport && msg.sreReport.type === 'optimize-config' && <ConfigReportWidget data={msg.sreReport.data} />}
                {msg.sreReport && msg.sreReport.type === 'generate-docs' && <DocsReportWidget data={msg.sreReport.data} />}
                {msg.sreReport && msg.sreReport.type === 'optimize-queries' && <QueriesReportWidget data={msg.sreReport.data} />}
                {msg.sreReport && msg.sreReport.type === 'inspect-logs' && <LogsReportWidget data={msg.sreReport.data} />}
                {msg.sreReport && msg.sreReport.type === 'predict-resources' && <TelemetryReportWidget data={msg.sreReport.data} />}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
              <div className="glass" style={{ padding: '12px 18px', borderRadius: 16, fontSize: '14px', color: 'var(--text-dim)', border: '1px solid var(--border)' }}>
                <div className="loading-spinner" style={{ width: 12, height: 12, display: 'inline-block', marginRight: 8 }}></div>
                {activeTool ? `Running ${activeTool} audit...` : 'Thinking...'}
              </div>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        <div style={{ padding: '0 24px', display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '20px' }}>
          {quickQuestions.map((q) => (
            <button key={q} onClick={() => handleQuickQuestion(q)} className="lp-btn-secondary" style={{ fontSize: '12px', padding: '6px 14px', borderRadius: 100 }}>
              {q}
            </button>
          ))}
        </div>

        <div style={{ padding: '20px 24px', background: 'rgba(0,0,0,0.2)', borderTop: '1px solid var(--border)' }}>
          <div style={{ position: 'relative' }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendMessage()}
              placeholder="Query the SRE co-pilot (e.g. 'Audit my memory limit suggestions' or custom)..."
              className="lp-search"
              style={{ width: '100%', maxWidth: 'none', paddingRight: 100, backgroundImage: 'none', paddingLeft: 20, height: 50 }}
            />
            <button 
              onClick={sendMessage} 
              disabled={loading || !input.trim()}
              className="lp-btn-primary" 
              style={{ position: 'absolute', right: 6, top: 6, bottom: 6, padding: '0 20px', fontSize: 13 }}
            >
              Ask AI
            </button>
          </div>
        </div>
      </div>

      {/* SRE Command Center Sidebar (1/3 width) */}
      <div className="lp-card glass" style={{ flex: '1 1 300px', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', minHeight: '650px' }}>
        <div>
          <h3 style={{ fontSize: 15, fontWeight: 800, marginBottom: 4, letterSpacing: '0.03em', color: 'var(--text-main)' }}>🛡️ SRE COMMAND CENTER</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.4 }}>Execute one-click deep neural scans on your codebase resources and active container instances.</p>
        </div>

        <div style={{ height: 1, background: 'var(--border)' }}></div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', flex: 1 }}>
          {sreTools.map((tool) => (
            <button
              key={tool.id}
              disabled={loading}
              onClick={() => handleSreTool(tool.id, tool.name)}
              style={{
                background: 'rgba(255, 255, 255, 0.02)',
                border: '1px solid var(--border)',
                borderRadius: '12px',
                padding: '14px',
                textAlign: 'left',
                cursor: loading ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start'
              }}
              onMouseEnter={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'rgba(56, 189, 248, 0.03)';
                  e.currentTarget.style.borderColor = 'var(--accent-primary)';
                }
              }}
              onMouseLeave={(e) => {
                if (!loading) {
                  e.currentTarget.style.background = 'rgba(255, 255, 255, 0.02)';
                  e.currentTarget.style.borderColor = 'var(--border)';
                }
              }}
            >
              <span style={{ fontSize: '20px', marginTop: '2px' }}>{tool.icon}</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-main)' }}>{tool.name}</span>
                <span style={{ fontSize: '11px', color: 'var(--text-dim)', lineHeight: '1.4' }}>{tool.desc}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}