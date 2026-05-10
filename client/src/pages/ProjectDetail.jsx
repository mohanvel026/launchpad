import { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../lib/api';
import MetricsChart       from '../components/MetricsChart';
import DomainManager      from '../components/DomainManager';
import TeamManager        from '../components/TeamManager';
import AIChat             from '../components/AIChat';
import AnalyticsDashboard from '../components/AnalyticsDashboard';
import { useAuth }        from '../hooks/useAuth';

const STATUS_COLOR = {
  live: '#22c55e', building: '#f59e0b',
  failed: '#f43f5e', idle: '#94a3b8', stopped: '#94a3b8',
};

const TABS = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'logs',        label: 'Logs' },
  { id: 'env',         label: 'Env Vars' },
  { id: 'metrics',     label: 'Metrics' },
  { id: 'analytics',   label: 'Analytics' },
  { id: 'domains',     label: 'Domains' },
  { id: 'team',        label: 'Team' },
  { id: 'ai',          label: '🤖 AI' },
];

export default function ProjectDetail() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [project,     setProject]     = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [logs,        setLogs]        = useState([]);
  const [deploying,   setDeploying]   = useState(false);
  const [activeTab,   setActiveTab]   = useState('deployments');
  const [envKey,      setEnvKey]      = useState('');
  const [envValue,    setEnvValue]    = useState('');
  const [envVars,     setEnvVars]     = useState([]);
  const [error,       setError]       = useState('');

  const logsEndRef = useRef(null);
  const socketRef  = useRef(null);

  const loadProject     = () => api.get(`/projects/${id}`).then((r) => setProject(r.data.project));
  const loadDeployments = () => api.get(`/deploy/${id}`).then((r) => setDeployments(r.data.deployments));
  const loadEnvVars     = () => api.get(`/env/${id}`).then((r) => setEnvVars(r.data.envVars)).catch(() => {});

  useEffect(() => {
    loadProject().catch(() => navigate('/dashboard'));
    loadDeployments();
    loadEnvVars();
    return () => socketRef.current?.disconnect();
  }, [id]);

  useEffect(() => { logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [logs]);

  const connectToLogs = (deploymentId) => {
    socketRef.current?.disconnect();
    setLogs([]);
    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000');
    socket.emit('join:deployment', deploymentId);
    socket.on('log', ({ line }) => setLogs((prev) => [...prev, line]));
    socketRef.current = socket;
  };

  const handleDeploy = async () => {
    setDeploying(true); setError(''); setActiveTab('logs');
    try {
      const res = await api.post(`/deploy/${id}`);
      connectToLogs(res.data.deployment._id);
      const poll = setInterval(async () => {
        const r = await api.get(`/deploy/${id}`);
        setDeployments(r.data.deployments);
        const latest = r.data.deployments[0];
        if (latest?.status === 'success' || latest?.status === 'failed') {
          clearInterval(poll); setDeploying(false); loadProject();
        }
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Deploy failed');
      setDeploying(false);
    }
  };

  const viewLogs = async (dep) => {
    setActiveTab('logs');
    const res = await api.get(`/deploy/${id}/${dep._id}`);
    setLogs(res.data.deployment.logs || []);
  };

  const handleRollback = async (dep) => {
    if (!window.confirm(`Roll back to commit ${dep.commitSha}?`)) return;
    try {
      await api.post(`/deploy/${id}/rollback/${dep._id}`);
      loadProject(); loadDeployments();
    } catch (err) { setError(err.response?.data?.message || 'Rollback failed'); }
  };

  const handleAddEnv = async () => {
    if (!envKey || !envValue) return;
    try {
      await api.post(`/env/${id}`, { key: envKey, value: envValue });
      await loadEnvVars(); setEnvKey(''); setEnvValue('');
    } catch (err) { setError(err.response?.data?.message || 'Failed to save env var'); }
  };

  const handleDeleteEnv = async (key) => {
    await api.delete(`/env/${id}/${key}`);
    setEnvVars((prev) => prev.filter((e) => e.key !== key));
  };

  const handleSuggestFix = async () => {
    try {
      const res = await api.post(`/ai/${id}/suggest-fix`);
      alert(`🤖 AI Suggestion:\n\n${res.data.suggestion}`);
    } catch { setError('AI fix suggestion failed'); }
  };

  if (!project) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', fontFamily: 'system-ui' }}>
      <div style={{ color: '#64748b' }}>Loading…</div>
    </div>
  );

  const f = { fontFamily: 'system-ui, sans-serif', maxWidth: '960px', margin: '0 auto', padding: '2rem' };
  const tabStyle = (t) => ({
    padding: '7px 14px', cursor: 'pointer', border: 'none', background: 'transparent',
    borderBottom: activeTab === t ? '2px solid #0070f3' : '2px solid transparent',
    color: activeTab === t ? '#0070f3' : '#64748b',
    fontSize: '13px', fontWeight: activeTab === t ? '600' : '400',
    whiteSpace: 'nowrap',
  });

  const domain = import.meta.env.VITE_DOMAIN || 'launchpad.dev';

  return (
    <div style={f}>
      {/* Back */}
      <button onClick={() => navigate('/dashboard')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', marginBottom: '1rem', fontSize: '13px' }}>
        ← Dashboard
      </button>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 4px' }}>{project.name}</h1>
          <div style={{ fontSize: '13px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <span>{project.repoFullName} · {project.branch}</span>
            <span style={{ color: STATUS_COLOR[project.status] || '#94a3b8', fontWeight: '500' }}>● {project.status}</span>
            {project.stack && (
              <span style={{ background: '#f1f5f9', padding: '2px 8px', borderRadius: '100px', fontSize: '11px' }}>
                {project.stack}
              </span>
            )}
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>{project.buildCount} deploys</span>
          </div>
          {project.subdomain && (
            <a href={`https://${project.subdomain}.${domain}`} target="_blank" rel="noreferrer"
              style={{ fontSize: '13px', color: '#0070f3', textDecoration: 'none', marginTop: '4px', display: 'inline-block' }}>
              {project.subdomain}.{domain} ↗
            </a>
          )}
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {project.status === 'failed' && (
            <button onClick={handleSuggestFix}
              style={{ padding: '9px 16px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
              🤖 AI Fix
            </button>
          )}
          <button onClick={handleDeploy} disabled={deploying}
            style={{ padding: '9px 20px', background: deploying ? '#93c5fd' : '#0070f3', color: '#fff', border: 'none', borderRadius: '8px', cursor: deploying ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: '500' }}>
            {deploying ? '⏳ Deploying…' : '🚀 Deploy'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ background: '#fff1f2', border: '1px solid #fca5a5', padding: '10px 14px', borderRadius: '8px', color: '#b91c1c', fontSize: '13px', marginBottom: '1rem' }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#b91c1c' }}>✕</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid #e2e8f0', marginBottom: '1.5rem', display: 'flex', gap: '2px', overflowX: 'auto' }}>
        {TABS.map((t) => (
          <button key={t.id} style={tabStyle(t.id)} onClick={() => setActiveTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Deployments ── */}
      {activeTab === 'deployments' && (
        <div>
          {deployments.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8', border: '1px dashed #e2e8f0', borderRadius: '12px' }}>
              No deployments yet. Hit 🚀 Deploy to start.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {deployments.map((dep, i) => (
                <div key={dep._id} style={{ border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem 1.2rem', background: i === 0 ? '#fafffe' : '#fff' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: '500', fontSize: '14px', marginBottom: '3px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {dep.commitMessage || 'Manual deploy'}
                        <span style={{ fontFamily: 'monospace', fontSize: '11px', color: '#64748b', background: '#f1f5f9', padding: '1px 6px', borderRadius: '4px' }}>
                          {dep.commitSha}
                        </span>
                        {i === 0 && <span style={{ fontSize: '10px', background: '#dbeafe', color: '#1d4ed8', padding: '1px 8px', borderRadius: '100px' }}>latest</span>}
                      </div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                        {dep.branch} ·{' '}
                        <span style={{ fontWeight: '500', color: dep.status === 'success' ? '#22c55e' : dep.status === 'failed' ? '#f43f5e' : dep.status === 'building' ? '#f59e0b' : '#94a3b8' }}>
                          {dep.status}
                        </span>
                        {dep.duration && ` · ${(dep.duration / 1000).toFixed(1)}s`}
                        {dep.triggeredBy && ` · by ${dep.triggeredBy.username}`}
                      </div>
                      {dep.aiErrorSummary && (
                        <div style={{ marginTop: '8px', fontSize: '12px', color: '#7c3aed', background: '#f5f3ff', padding: '8px 12px', borderRadius: '6px', lineHeight: '1.5' }}>
                          🤖 {dep.aiErrorSummary}
                        </div>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: '6px', marginLeft: '12px' }}>
                      <button onClick={() => viewLogs(dep)}
                        style={{ fontSize: '12px', padding: '5px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', background: '#fff' }}>
                        Logs
                      </button>
                      {dep.status === 'success' && i !== 0 && (
                        <button onClick={() => handleRollback(dep)}
                          style={{ fontSize: '12px', padding: '5px 12px', border: '1px solid #fca5a5', borderRadius: '6px', cursor: 'pointer', background: '#fff1f2', color: '#b91c1c' }}>
                          Rollback
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Logs ── */}
      {activeTab === 'logs' && (
        <div>
          <div style={{ background: '#0f172a', borderRadius: '12px', padding: '1rem 1.2rem', minHeight: '300px', maxHeight: '500px', overflowY: 'auto', fontFamily: 'monospace' }}>
            {logs.length === 0 ? (
              <div style={{ color: '#475569', fontSize: '13px' }}>No logs. Trigger a deploy or click "Logs" on a deployment above.</div>
            ) : logs.map((line, i) => (
              <div key={i} style={{ fontSize: '12px', lineHeight: '1.8',
                color: line.includes('❌') ? '#f87171' : line.includes('✅') ? '#4ade80' : line.includes('🤖') ? '#c084fc' : line.includes('Warning') ? '#fbbf24' : '#94a3b8' }}>
                {line}
              </div>
            ))}
            <div ref={logsEndRef} />
          </div>
          {deploying && (
            <div style={{ marginTop: '8px', fontSize: '12px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#f59e0b', animation: 'pulse 1s infinite' }} />
              Live — deployment in progress
            </div>
          )}
        </div>
      )}

      {/* ── Env Vars ── */}
      {activeTab === 'env' && (
        <div>
          <p style={{ fontSize: '13px', color: '#64748b', marginBottom: '1rem' }}>
            Values are AES-256 encrypted at rest and injected into your container at deploy time. Values are never shown after saving.
          </p>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '1rem' }}>
            <input value={envKey} onChange={(e) => setEnvKey(e.target.value.toUpperCase())} placeholder="KEY_NAME"
              style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace', width: '200px' }} />
            <input value={envValue} onChange={(e) => setEnvValue(e.target.value)} placeholder="value" type="password"
              style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', flex: 1 }} />
            <button onClick={handleAddEnv} disabled={!envKey || !envValue}
              style={{ padding: '8px 16px', background: !envKey || !envValue ? '#e2e8f0' : '#0070f3', color: !envKey || !envValue ? '#94a3b8' : '#fff', border: 'none', borderRadius: '8px', cursor: !envKey || !envValue ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
              Save
            </button>
          </div>
          {envVars.length === 0 ? (
            <p style={{ color: '#94a3b8', fontSize: '13px' }}>No env vars set.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {envVars.map((e) => (
                <div key={e._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', border: '1px solid #e2e8f0', borderRadius: '8px', fontFamily: 'monospace', fontSize: '13px' }}>
                  <span style={{ color: '#0070f3', fontWeight: '500' }}>{e.key}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: '#94a3b8' }}>••••••••</span>
                    <button onClick={() => handleDeleteEnv(e.key)}
                      style={{ background: 'none', border: 'none', color: '#f43f5e', cursor: 'pointer', fontSize: '12px' }}>Delete</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {envVars.length > 0 && (
            <p style={{ fontSize: '12px', color: '#94a3b8', marginTop: '12px' }}>
              ⚠️ Redeploy your app after changing env vars for changes to take effect.
            </p>
          )}
        </div>
      )}

      {/* ── Metrics ── */}
      {activeTab === 'metrics' && <MetricsChart projectId={project._id} />}

      {/* ── Analytics ── */}
      {activeTab === 'analytics' && <AnalyticsDashboard projectId={project._id} />}

      {/* ── Domains ── */}
      {activeTab === 'domains' && <DomainManager project={project} />}

      {/* ── Team ── */}
      {activeTab === 'team' && <TeamManager project={project} currentUser={user} />}

      {/* ── AI Chat ── */}
      {activeTab === 'ai' && <AIChat projectId={project._id} />}
    </div>
  );
}