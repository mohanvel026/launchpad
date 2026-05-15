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
  { id: 'deployments', label: 'Deployments', icon: '🚀' },
  { id: 'logs',        label: 'Build Logs',  icon: '📄' },
  { id: 'env',         label: 'Environment', icon: '🔑' },
  { id: 'metrics',     label: 'Metrics',     icon: '📈' },
  { id: 'analytics',   label: 'Analytics',   icon: '📊' },
  { id: 'domains',     label: 'Domains',     icon: '🌐' },
  { id: 'team',        label: 'Team',        icon: '👥' },
  { id: 'ai',          label: 'AI Diagnostic', icon: '✨' },
  { id: 'settings',    label: 'Settings',    icon: '⚙️' },
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
  const [bulkEnv,     setBulkEnv]     = useState('');
  const [showBulk,    setShowBulk]    = useState(false);
  const [error,       setError]       = useState('');
  const [saveStatus,  setSaveStatus]  = useState('');

  // Build Settings State
  const [buildConfig, setBuildConfig] = useState({
    installCommand: '',
    buildCommand: '',
    outputDir: ''
  });

  const logsEndRef = useRef(null);
  const socketRef  = useRef(null);

  const loadProject = async () => {
    try {
      const r = await api.get(`/projects/${id}`);
      setProject(r.data.project);
      setBuildConfig({
        installCommand: r.data.project.installCommand || '',
        buildCommand: r.data.project.buildCommand || '',
        outputDir: r.data.project.outputDir || ''
      });
    } catch { navigate('/dashboard'); }
  };

  const loadDeployments = () => api.get(`/deploy/${id}`).then((r) => setDeployments(r.data.deployments));
  const loadEnvVars     = () => api.get(`/env/${id}`).then((r) => setEnvVars(r.data.envVars)).catch(() => {});

  useEffect(() => {
    loadProject();
    loadDeployments();
    loadEnvVars();
    return () => socketRef.current?.disconnect();
  }, [id]);

  useEffect(() => { 
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }); 
    }
  }, [logs, activeTab]);

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

  const handleUpdateBuild = async () => {
    try {
      setSaveStatus('Saving...');
      await api.patch(`/projects/${id}`, buildConfig);
      setSaveStatus('Build settings updated!');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch { setError('Failed to update build settings'); }
  };

  const handleAddEnv = async () => {
    if (!envKey || !envValue) return;
    try {
      await api.post(`/env/${id}`, { key: envKey, value: envValue });
      await loadEnvVars(); setEnvKey(''); setEnvValue('');
    } catch (err) { setError(err.response?.data?.message || 'Failed to save env var'); }
  };

  const handleBulkEnv = async () => {
    const pairs = bulkEnv.split('\n').filter(l => l.includes('='));
    try {
      for (const p of pairs) {
        const [k, v] = p.split('=');
        await api.post(`/env/${id}`, { key: k.trim(), value: v.trim() });
      }
      await loadEnvVars();
      setBulkEnv('');
      setShowBulk(false);
    } catch { setError('Bulk import failed partly'); }
  };

  const handleDeleteEnv = async (key) => {
    await api.delete(`/env/${id}/${key}`);
    setEnvVars((prev) => prev.filter((e) => e.key !== key));
  };

  if (!project) return (
    <div className="launchpad-container flex-center">
      <div className="loading-spinner" style={{ width: 48, height: 48 }}></div>
    </div>
  );

  const domain = import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io';

  return (
    <div className="launchpad-container">
      <header className="lp-header">
        <div className="lp-logo" onClick={() => navigate('/dashboard')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
          </svg>
          LaunchPad
        </div>
        <button className="lp-btn-secondary" onClick={() => navigate('/dashboard')}>Dashboard</button>
      </header>

      <div className="glass" style={{ borderBottom: '1px solid var(--border)', padding: '48px 0 0' }}>
        <div style={{ maxWidth: 1300, margin: '0 auto', padding: '0 40px 40px' }}>
          <div className="flex-between" style={{ flexWrap: 'wrap', gap: 32 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12 }}>
                <h1 style={{ fontSize: 36, margin: 0 }}>{project.name}</h1>
                <div className={`lp-badge ${project.status}`}>{project.status}</div>
              </div>
              
              <div style={{ display: 'flex', gap: 24, color: 'var(--text-muted)', fontSize: 14 }}>
                <div className="flex-center" style={{ gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                  {project.repoFullName}
                </div>
                <div className="flex-center" style={{ gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="6" y1="3" x2="6" y2="15"></line><circle cx="18" cy="6" r="3"></circle><circle cx="6" cy="18" r="3"></circle><path d="M18 9a9 9 0 0 1-9 9"></path></svg>
                  {project.branch}
                </div>
              </div>

              {project.subdomain && (
                <a href={`http://${project.subdomain}.${domain}`} target="_blank" rel="noreferrer" 
                   style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 16, color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600, fontSize: 15 }}>
                  {project.subdomain}.{domain}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                </a>
              )}
            </div>

            <div style={{ display: 'flex', gap: 12 }}>
              <button onClick={handleDeploy} disabled={deploying} className={`lp-btn-primary ${deploying ? 'animate-pulse-cyan' : ''}`}>
                {deploying ? 'Initializing...' : 'Redeploy'}
              </button>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1300, margin: '0 auto', padding: '0 40px' }}>
          <div style={{ display: 'flex', gap: 32, overflowX: 'auto' }}>
            {TABS.map(t => (
              <div key={t.id} onClick={() => setActiveTab(t.id)}
                   style={{ 
                     padding: '0 0 14px', 
                     color: activeTab === t.id ? 'var(--text-main)' : 'var(--text-muted)', 
                     fontWeight: activeTab === t.id ? 600 : 500, 
                     cursor: 'pointer', 
                     borderBottom: activeTab === t.id ? '2px solid var(--accent-primary)' : '2px solid transparent', 
                     whiteSpace: 'nowrap', 
                     transition: 'all 0.2s',
                     fontSize: 14,
                     display: 'flex',
                     alignItems: 'center',
                     gap: 8
                   }}>
                <span>{t.icon}</span> {t.label}
              </div>
            ))}
          </div>
        </div>
      </div>

      <main className="lp-main" style={{ maxWidth: 1300, margin: '0 auto', padding: '40px' }}>
        {error && (
          <div className="glass" style={{ border: '1px solid var(--accent-danger)', padding: '16px', borderRadius: '12px', color: 'var(--accent-danger)', marginBottom: '32px', display: 'flex', justifyContent: 'space-between' }}>
            {error}
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── Environment Variables ── */}
        {activeTab === 'env' && (
          <div className="lp-card glass" style={{ padding: 32 }}>
            <div className="flex-between" style={{ marginBottom: 24 }}>
              <div>
                <h3 style={{ margin: 0 }}>Environment Variables</h3>
                <p className="text-muted" style={{ margin: '4px 0 0' }}>Configuration secrets for your runtime environment.</p>
              </div>
              <button onClick={() => setShowBulk(!showBulk)} className="lp-btn-secondary" style={{ fontSize: 12 }}>
                {showBulk ? 'Manual Entry' : 'Bulk Import'}
              </button>
            </div>
            
            {!showBulk ? (
              <div style={{ display: 'flex', gap: 16, marginBottom: 32 }}>
                <input value={envKey} onChange={(e) => setEnvKey(e.target.value.toUpperCase())} placeholder="VARIABLE_NAME" className="lp-search" style={{ flex: 1, backgroundImage: 'none', paddingLeft: 16 }} />
                <input value={envValue} onChange={(e) => setEnvValue(e.target.value)} placeholder="Value" type="password" className="lp-search" style={{ flex: 2, backgroundImage: 'none', paddingLeft: 16 }} />
                <button onClick={handleAddEnv} className="lp-btn-primary" style={{ padding: '0 24px' }}>Add</button>
              </div>
            ) : (
              <div style={{ marginBottom: 32 }}>
                <textarea 
                  value={bulkEnv} 
                  onChange={(e) => setBulkEnv(e.target.value)} 
                  placeholder="PORT=3000&#10;DATABASE_URL=mongodb://...&#10;API_KEY=xyz" 
                  className="lp-search" 
                  style={{ width: '100%', height: 120, backgroundImage: 'none', paddingLeft: 16, paddingTop: 12, resize: 'none' }}
                />
                <button onClick={handleBulkEnv} className="lp-btn-primary" style={{ marginTop: 12, width: '100%' }}>Import All Variables</button>
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {envVars.map(e => (
                <div key={e._id} className="flex-between glass" style={{ padding: '16px 24px', borderRadius: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-primary)' }}></div>
                    <span className="mono" style={{ fontWeight: 700 }}>{e.key}</span>
                  </div>
                  <div className="flex-center" style={{ gap: 24 }}>
                    <span className="text-dim mono" style={{ letterSpacing: 4 }}>••••••••</span>
                    <button onClick={() => handleDeleteEnv(e.key)} style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 13 }}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Settings View ── */}
        {activeTab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
            <div className="lp-card glass" style={{ padding: 32 }}>
              <h3 style={{ margin: '0 0 24px' }}>Build & Development</h3>
              <div style={{ display: 'grid', gap: 24 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Install Command</label>
                  <input 
                    value={buildConfig.installCommand} 
                    onChange={(e) => setBuildConfig({ ...buildConfig, installCommand: e.target.value })} 
                    placeholder="npm install" 
                    className="lp-search" 
                    style={{ width: '100%', backgroundImage: 'none', paddingLeft: 16 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Build Command</label>
                  <input 
                    value={buildConfig.buildCommand} 
                    onChange={(e) => setBuildConfig({ ...buildConfig, buildCommand: e.target.value })} 
                    placeholder="npm run build" 
                    className="lp-search" 
                    style={{ width: '100%', backgroundImage: 'none', paddingLeft: 16 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>Output Directory</label>
                  <input 
                    value={buildConfig.outputDir} 
                    onChange={(e) => setBuildConfig({ ...buildConfig, outputDir: e.target.value })} 
                    placeholder="dist" 
                    className="lp-search" 
                    style={{ width: '100%', backgroundImage: 'none', paddingLeft: 16 }}
                  />
                </div>
                <div className="flex-between">
                  <span style={{ color: 'var(--accent-success)', fontSize: 14, fontWeight: 600 }}>{saveStatus}</span>
                  <button onClick={handleUpdateBuild} className="lp-btn-primary">Save Settings</button>
                </div>
              </div>
            </div>

            <div className="lp-card glass" style={{ padding: 32 }}>
              <h3 style={{ margin: '0 0 16px' }}>Project Configuration</h3>
              <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 32 }}>
                <h4 style={{ color: 'var(--accent-danger)', margin: '0 0 8px' }}>Danger Zone</h4>
                <p className="text-muted">Once you delete a project, there is no going back. Please be certain.</p>
                <button onClick={() => { if(window.confirm('Delete project?')) api.delete(`/projects/${id}`).then(() => navigate('/dashboard')) }} 
                        className="lp-btn-secondary" style={{ marginTop: 16, color: 'var(--accent-danger)', borderColor: 'rgba(239, 68, 68, 0.3)' }}>
                  Delete Project Instance
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Legacy Views ── */}
        {activeTab === 'deployments' && (
          <div className="lp-card glass" style={{ padding: 0 }}>
            {deployments.length === 0 ? (
              <div style={{ padding: '80px 20px', textAlign: 'center', color: 'var(--text-muted)' }}>
                No deployments yet. Let's get shipping!
              </div>
            ) : (
              deployments.map((dep, i) => (
                <div key={dep._id} style={{ 
                  padding: '24px 32px', 
                  borderBottom: i === deployments.length - 1 ? 'none' : '1px solid var(--border)',
                  display: 'flex', 
                  justifyContent: 'space-between', 
                  alignItems: 'center'
                }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 17, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
                      {dep.commitMessage || 'Manual Deployment'}
                      <span className="mono" style={{ fontSize: 12, background: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: 4, color: 'var(--text-dim)' }}>{dep.commitSha?.slice(0,7)}</span>
                      {i === 0 && <span className="lp-badge live" style={{ fontSize: 10 }}>Production</span>}
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className={`lp-badge ${dep.status}`} style={{ fontSize: 10, padding: '2px 8px' }}>{dep.status}</span>
                      <span>{dep.branch}</span>
                      {dep.duration && <span>· {(dep.duration / 1000).toFixed(1)}s</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button onClick={() => viewLogs(dep)} className="lp-btn-secondary">View Logs</button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'logs' && (
          <div className="lp-terminal">
            <div className="lp-terminal-header">
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ff5f56' }}></div>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }}></div>
                <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }}></div>
              </div>
              <div>Build Terminal Output</div>
              {deploying && <div style={{ color: 'var(--accent-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                <div className="loading-spinner" style={{ width: 12, height: 12 }}></div> Live Stream
              </div>}
            </div>
            <div className="lp-terminal-body">
              {logs.length === 0 ? (
                <div style={{ opacity: 0.5 }}>Waiting for build cycle to initialize...</div>
              ) : logs.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {activeTab === 'metrics' && <MetricsChart projectId={project._id} />}
        {activeTab === 'analytics' && <AnalyticsDashboard projectId={project._id} />}
        {activeTab === 'domains' && <DomainManager project={project} />}
        {activeTab === 'team' && <TeamManager project={project} currentUser={user} />}
        {activeTab === 'ai' && <AIChat projectId={project._id} />}
      </main>
    </div>
  );
}