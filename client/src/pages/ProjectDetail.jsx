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

const TABS = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'logs',        label: 'Build Logs' },
  { id: 'env',         label: 'Env Variables' },
  { id: 'metrics',     label: 'Metrics' },
  { id: 'analytics',   label: 'Analytics' },
  { id: 'domains',     label: 'Domains' },
  { id: 'team',        label: 'Team' },
  { id: 'ai',          label: 'AI Diagnostic' },
  { id: 'settings',    label: 'Settings' },
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

  const handleDeleteProject = async () => {
    if (!window.confirm('Are you absolutely sure you want to delete this project? This will remove all deployments and cannot be undone.')) return;
    try {
      await api.delete(`/projects/${id}`);
      navigate('/dashboard');
    } catch (err) { setError(err.response?.data?.message || 'Failed to delete project'); }
  };

  if (!project) return (
    <div className="launchpad-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
      <div className="spinner" style={{ width: 40, height: 40, borderTopColor: 'var(--accent-cyan)' }}></div>
    </div>
  );

  const domain = import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io';

  return (
    <div className="launchpad-container">
      {/* Header */}
      <header className="lp-header">
        <div className="lp-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#gradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#06B6D4" /><stop offset="100%" stopColor="#8B5CF6" /></linearGradient></defs>
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
          </svg>
          LaunchPad
        </div>
        <button className="lp-btn-secondary" onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
      </header>

      {/* Project Sub-header */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '40px 40px 0' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 24, paddingBottom: 32 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
              <h1 style={{ fontSize: 32, margin: 0 }}>{project.name}</h1>
              <div className={`lp-badge ${project.status}`}>{project.status}</div>
            </div>
            
            <div style={{ display: 'flex', gap: 24, color: 'var(--text-muted)', fontSize: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                {project.repoFullName}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
                {project.branch}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
                {project.stack || 'Unknown Stack'}
              </div>
            </div>

            {project.subdomain && (
              <a href={`http://${project.subdomain}.${domain}`} target="_blank" rel="noreferrer" style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, color: 'var(--accent-cyan)', textDecoration: 'none', fontWeight: 600 }}>
                {project.subdomain}.{domain}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
              </a>
            )}
          </div>

          <div style={{ display: 'flex', gap: 12 }}>
            {project.status === 'failed' && (
              <button onClick={handleSuggestFix} className="lp-btn-secondary" style={{ borderColor: 'var(--accent-purple)', color: 'var(--accent-purple)' }}>
                ✨ AI Diagnostic
              </button>
            )}
            <button onClick={handleDeploy} disabled={deploying} className="lp-btn-primary">
              {deploying ? 'Initializing Build...' : 'Deploy to Edge'}
            </button>
          </div>
        </div>

        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 32, overflowX: 'auto', position: 'relative', top: 1 }}>
          {TABS.map(t => (
            <div key={t.id} onClick={() => setActiveTab(t.id)}
                 style={{ padding: '0 0 16px', color: activeTab === t.id ? 'var(--text-main)' : 'var(--text-muted)', fontWeight: activeTab === t.id ? 600 : 500, cursor: 'pointer', borderBottom: activeTab === t.id ? '2px solid var(--accent-cyan)' : '2px solid transparent', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
              {t.label}
            </div>
          ))}
        </div>
      </div>

      <main className="lp-main">
        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '16px', borderRadius: '12px', color: '#F87171', marginBottom: '24px', display: 'flex', justifyContent: 'space-between' }}>
            {error}
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── Deployments ── */}
        {activeTab === 'deployments' && (
          <div className="lp-card" style={{ padding: 0, overflow: 'hidden' }}>
            {deployments.length === 0 ? (
              <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>No deployments history found. Trigger your first build!</div>
            ) : (
              deployments.map((dep, i) => (
                <div key={dep._id} style={{ padding: '20px 24px', borderBottom: i === deployments.length - 1 ? 'none' : '1px solid var(--border)', background: i === 0 ? 'rgba(255,255,255,0.02)' : 'transparent', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      {dep.commitMessage || 'Manual trigger from Dashboard'}
                      <span style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--border)', padding: '2px 8px', borderRadius: 6, color: 'var(--text-muted)' }}>{dep.commitSha}</span>
                      {i === 0 && <span style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--accent-cyan)', fontSize: 11, padding: '2px 8px', borderRadius: 100, fontWeight: 700 }}>LATEST</span>}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      {dep.branch} · 
                      <span style={{ color: dep.status === 'success' ? '#34D399' : dep.status === 'failed' ? '#F87171' : '#FBBF24', fontWeight: 600, textTransform: 'uppercase', fontSize: 12 }}>
                        {dep.status}
                      </span>
                      {dep.duration && ` · ${(dep.duration / 1000).toFixed(1)}s`}
                    </div>
                    {dep.aiErrorSummary && (
                      <div style={{ marginTop: 12, fontSize: 13, color: '#E9D5FF', background: 'rgba(139, 92, 246, 0.1)', border: '1px solid rgba(139, 92, 246, 0.2)', padding: '10px 14px', borderRadius: 8 }}>
                        ✨ AI: {dep.aiErrorSummary}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={() => viewLogs(dep)} className="lp-btn-secondary">View Logs</button>
                    {dep.status === 'success' && i !== 0 && (
                      <button onClick={() => handleRollback(dep)} className="lp-btn-secondary" style={{ borderColor: 'rgba(239, 68, 68, 0.5)', color: '#F87171' }}>Rollback</button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Logs ── */}
        {activeTab === 'logs' && (
          <div className="lp-card" style={{ padding: 0, background: '#050914', overflow: 'hidden' }}>
            <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 600 }}>Container Build Output</div>
              {deploying && <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--accent-cyan)' }}><div className="spinner" style={{ width: 14, height: 14, borderTopColor: 'var(--accent-cyan)', borderWidth: 2 }}></div> Live Stream</div>}
            </div>
            <div style={{ padding: '24px', minHeight: '400px', maxHeight: '600px', overflowY: 'auto', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 13, lineHeight: 1.6 }}>
              {logs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>No logs available for this build phase.</div>
              ) : logs.map((line, i) => (
                <div key={i} style={{ color: line.includes('❌') || line.toLowerCase().includes('error') ? '#F87171' : line.includes('✅') || line.toLowerCase().includes('success') ? '#34D399' : line.includes('🤖') ? '#C084FC' : 'var(--text-muted)' }}>
                  {line}
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* ── Env Vars ── */}
        {activeTab === 'env' && (
          <div className="lp-card">
            <h2 style={{ fontSize: 24, marginBottom: 8, marginTop: 0 }}>Environment Variables</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Secrets are AES-256 encrypted at rest and injected into the container at build time.</p>
            
            <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
              <input value={envKey} onChange={(e) => setEnvKey(e.target.value.toUpperCase())} placeholder="SECRET_KEY" className="lp-search" style={{ width: '300px', backgroundImage: 'none', paddingLeft: 16 }} />
              <input value={envValue} onChange={(e) => setEnvValue(e.target.value)} placeholder="Secret Value" type="password" className="lp-search" style={{ flex: 1, maxWidth: 'none', backgroundImage: 'none', paddingLeft: 16 }} />
              <button onClick={handleAddEnv} disabled={!envKey || !envValue} className="lp-btn-primary" style={{ opacity: (!envKey || !envValue) ? 0.5 : 1 }}>Add Secret</button>
            </div>

            {envVars.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 12, color: 'var(--text-muted)' }}>No environment variables configured.</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {envVars.map(e => (
                  <div key={e._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 20px', border: '1px solid var(--border)', borderRadius: 8, background: 'rgba(255,255,255,0.02)' }}>
                    <span style={{ color: 'var(--accent-cyan)', fontFamily: 'monospace', fontWeight: 600 }}>{e.key}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                      <span style={{ color: 'var(--text-muted)', letterSpacing: 4 }}>••••••••••••</span>
                      <button onClick={() => handleDeleteEnv(e.key)} className="lp-btn-secondary" style={{ padding: '6px 12px', fontSize: 13, borderColor: 'rgba(239, 68, 68, 0.3)', color: '#F87171' }}>Delete</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            {envVars.length > 0 && <p style={{ fontSize: 13, color: '#FBBF24', marginTop: 24 }}>⚠️ You must trigger a new deployment for variable changes to take effect.</p>}
          </div>
        )}

        {/* ── Additional Views ── */}
        {activeTab === 'metrics' && <div className="lp-card"><MetricsChart projectId={project._id} /></div>}
        {activeTab === 'analytics' && <div className="lp-card"><AnalyticsDashboard projectId={project._id} /></div>}
        {activeTab === 'domains' && <div className="lp-card"><DomainManager project={project} /></div>}
        {activeTab === 'team' && <div className="lp-card"><TeamManager project={project} currentUser={user} /></div>}
        {activeTab === 'ai' && <div className="lp-card"><AIChat projectId={project._id} /></div>}
        
        {activeTab === 'settings' && (
          <div className="lp-card">
            <h2 style={{ fontSize: 24, marginBottom: 8, marginTop: 0 }}>Project Settings</h2>
            <p style={{ color: 'var(--text-muted)', marginBottom: 32 }}>Manage your project configuration and danger zone.</p>
            
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 32 }}>
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>Delete Project</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Permanently delete this project and all associated deployments. This action cannot be undone and will immediately stop serving your application.</p>
              <button onClick={handleDeleteProject} className="lp-btn-secondary" style={{ borderColor: 'rgba(239, 68, 68, 0.5)', color: '#F87171' }}>Delete Project</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}