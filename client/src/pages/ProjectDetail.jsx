import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

// Advanced LaunchPad Sub-components
import MetricsChart from '../components/MetricsChart';
import AnalyticsDashboard from '../components/AnalyticsDashboard';
import DomainManager from '../components/DomainManager';
import TeamManager from '../components/TeamManager';
import AIChat from '../components/AIChat';

const TABS = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'logs',        label: 'Build Logs' },
  { id: 'env',         label: 'Environment' },
  { id: 'domains',     label: 'Domains' },
  { id: 'metrics',     label: 'Live Metrics' },
  { id: 'analytics',   label: 'Analytics' },
  { id: 'team',        label: 'Team' },
  { id: 'ai',          label: 'AI Co-Pilot' },
  { id: 'settings',    label: 'Settings' },
];

function LogLine({ line }) {
  let cls = '';
  if (/✅|success|done|built|complete|ready/i.test(line)) cls = 'lp-log-success';
  else if (/❌|error|failed|exit code [^0]/i.test(line)) cls = 'lp-log-error';
  else if (/⚠️|warn/i.test(line)) cls = 'lp-log-warn';
  else if (/📦|📝|🔍|🐳|phase|cloning|pulling|building/i.test(line)) cls = 'lp-log-step';
  else if (/🚀|live|deployed/i.test(line)) cls = 'lp-log-info';
  return <div className={cls}>{line}</div>;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [project,     setProject]     = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [logs,        setLogs]        = useState([]);
  const [deploying,   setDeploying]   = useState(false);
  const [activeTab,   setActiveTab]   = useState('deployments');
  const [error,       setError]       = useState('');
  const [saveStatus,  setSaveStatus]  = useState('');

  // Env vars
  const [envVars,  setEnvVars]  = useState([]);
  const [envKey,   setEnvKey]   = useState('');
  const [envValue, setEnvValue] = useState('');
  const [showBulk, setShowBulk] = useState(false);
  const [bulkEnv,  setBulkEnv]  = useState('');
  const [showVal,  setShowVal]  = useState({});

  // Settings
  const [settings, setSettings] = useState({ installCommand: '', buildCommand: '', outputDir: '', branch: '' });

  const logsEndRef = useRef(null);
  const socketRef  = useRef(null);
  const pollRef    = useRef(null);

  const loadProject = useCallback(async () => {
    try {
      const r = await api.get(`/projects/${id}`);
      const p = r.data.project;
      setProject(p);
      setSettings({
        installCommand: p.installCommand || '',
        buildCommand:   p.buildCommand   || '',
        outputDir:      p.outputDir      || '',
        branch:         p.branch         || 'main',
      });
    } catch { navigate('/dashboard'); }
  }, [id, navigate]);

  const loadDeployments = useCallback(() =>
    api.get(`/deploy/${id}`).then(r => setDeployments(r.data.deployments || [])).catch(() => {}),
  [id]);

  const loadEnvVars = useCallback(() =>
    api.get(`/env/${id}`).then(r => setEnvVars(r.data.envVars || [])).catch(() => {}),
  [id]);

  useEffect(() => {
    loadProject();
    loadDeployments();
    loadEnvVars();
    return () => {
      socketRef.current?.disconnect();
      clearInterval(pollRef.current);
    };
  }, [loadProject, loadDeployments, loadEnvVars]);

  // Auto-load latest deployment logs when switching to Build Logs tab
  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      // If no logs yet and we're not mid-deploy, load the latest deployment's logs
      if (logs.length === 0 && !deploying && deployments.length > 0) {
        viewLogs(deployments[0]);
      }
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'logs') logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const connectToLogs = async (deploymentId) => {
    socketRef.current?.disconnect();
    setLogs([]);

    // Fetch any logs already stored in DB (handles page refresh / mid-build reconnect)
    try {
      const r = await api.get(`/deploy/${id}/${deploymentId}`);
      const stored = r.data.deployment?.logs || [];
      if (stored.length > 0) setLogs(stored);
    } catch { /* no stored logs yet */ }

    // Connect socket for live streaming of future log lines
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],  // polling fallback if nginx doesn't upgrade WS
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    socket.emit('join:deployment', deploymentId);
    socket.on('log', ({ line }) => setLogs(prev => [...prev, line]));
    socket.on('connect_error', (err) => console.warn('Socket error:', err.message));
    socketRef.current = socket;
  };

  const handleDeploy = async () => {
    setDeploying(true); setError(''); setActiveTab('logs'); setLogs([]);
    try {
      const res = await api.post(`/deploy/${id}`);
      connectToLogs(res.data.deployment._id);
      pollRef.current = setInterval(async () => {
        const r = await api.get(`/deploy/${id}`);
        setDeployments(r.data.deployments || []);
        const latest = r.data.deployments?.[0];
        if (latest?.status === 'success' || latest?.status === 'failed') {
          clearInterval(pollRef.current);
          setDeploying(false);
          loadProject();
        }
      }, 3000);
    } catch (err) {
      setError(err.response?.data?.message || 'Deployment failed');
      setDeploying(false);
    }
  };

  const handleClearStuck = async () => {
    try {
      await api.post(`/projects/${id}/clear-stuck`);
      setError('');
      loadProject();
      loadDeployments();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to reset build status');
    }
  };

  const viewLogs = async (dep) => {
    setActiveTab('logs');
    try {
      const res = await api.get(`/deploy/${id}/${dep._id}`);
      setLogs(res.data.deployment?.logs || []);
    } catch { setLogs(['Failed to load logs.']); }
  };

  const handleSaveSettings = async () => {
    try {
      setSaveStatus('saving');
      await api.patch(`/projects/${id}`, settings);
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(''), 3000);
    } catch { setSaveStatus('error'); setTimeout(() => setSaveStatus(''), 3000); }
  };

  const handleAddEnv = async () => {
    if (!envKey.trim() || !envValue.trim()) return;
    try {
      await api.post(`/env/${id}`, { key: envKey.trim(), value: envValue.trim() });
      setEnvKey(''); setEnvValue('');
      loadEnvVars();
    } catch (err) { setError(err.response?.data?.message || 'Failed to add variable'); }
  };

  const handleBulkImport = async () => {
    const lines = bulkEnv.split('\n').filter(l => l.includes('=') && !l.startsWith('#'));
    try {
      for (const line of lines) {
        const eqIdx = line.indexOf('=');
        const k = line.slice(0, eqIdx).trim();
        const v = line.slice(eqIdx + 1).trim();
        if (k && v) await api.post(`/env/${id}`, { key: k, value: v });
      }
      setBulkEnv(''); setShowBulk(false); loadEnvVars();
    } catch { setError('Bulk import partially failed. Check your format.'); }
  };

  const handleDeleteEnv = async (key) => {
    if (!window.confirm(`Delete ${key}?`)) return;
    await api.delete(`/env/${id}/${key}`);
    setEnvVars(prev => prev.filter(e => e.key !== key));
  };

  const handleDeleteProject = async () => {
    if (!window.confirm(`Permanently delete "${project?.name}"? This cannot be undone.`)) return;
    await api.delete(`/projects/${id}`);
    navigate('/dashboard');
  };

  if (!project) return (
    <div className="launchpad-container flex-center" style={{ minHeight: '100vh' }}>
      <div className="loading-spinner" style={{ width: 40, height: 40 }} />
    </div>
  );

  const domain = import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io';
  const deployUrl = project.subdomain ? `http://${project.subdomain}.${domain}` : null;

  return (
    <div className="launchpad-container">
      {/* Header */}
      <header className="lp-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="lp-btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => navigate('/dashboard')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Dashboard
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>{project.name}</span>
          <span className={`lp-badge ${deploying ? 'building' : (project.status || 'idle')}`}>
            {deploying ? 'building' : (project.status || 'idle')}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {deployUrl && (
            <a href={deployUrl} target="_blank" rel="noreferrer" className="lp-btn-secondary" style={{ padding: '6px 14px', fontSize: 13 }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
              Visit
            </a>
          )}
          <button onClick={handleDeploy} disabled={deploying} className={`lp-btn-primary ${deploying ? 'animate-pulse-cyan' : ''}`}>
            {deploying ? 'Deploying...' : '🚀 Redeploy'}
          </button>
        </div>
      </header>

      {/* Project Info Bar */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '12px 40px' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-muted)' }}>
          <span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 6 }}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
            {project.repoFullName}
          </span>
          <span>Branch: <strong style={{ color: 'var(--text-main)' }}>{project.branch}</strong></span>
          <span>Framework: <strong style={{ color: 'var(--text-main)' }}>{project.framework || 'auto'}</strong></span>
          {deployUrl && <span>URL: <a href={deployUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{deployUrl.replace('http://', '')}</a></span>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ borderBottom: '1px solid var(--border)', padding: '0 40px', background: 'var(--bg-glass)', backdropFilter: 'blur(12px)' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', display: 'flex', gap: 0 }}>
          {TABS.map(t => (
            <div key={t.id} className={`lp-pill ${activeTab === t.id ? 'active' : ''}`} onClick={() => setActiveTab(t.id)}>{t.label}</div>
          ))}
        </div>
      </div>

      <main className="lp-main" style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {error && (
          <div className="lp-status-bar error" style={{ marginBottom: 20, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span>⚠️ {error}</span>
            {error.toLowerCase().includes('in progress') && (
              <button 
                onClick={handleClearStuck} 
                className="lp-btn-secondary" 
                style={{ 
                  marginLeft: 16, 
                  padding: '4px 12px', 
                  fontSize: 12, 
                  background: 'rgba(239, 68, 68, 0.2)', 
                  border: '1px solid rgba(239, 68, 68, 0.4)',
                  color: '#fca5a5',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                ⚡ Force Reset Build State
              </button>
            )}
            <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── Deployments ── */}
        {activeTab === 'deployments' && (
          <div className="fade-in">
            <div className="lp-card" style={{ padding: 0 }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
                <h3 style={{ fontSize: 16 }}>Deployment History</h3>
              </div>
              {deployments.length === 0 ? (
                <div className="flex-center" style={{ padding: 60, flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 32 }}>🚀</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No deployments yet. Click Redeploy to start.</p>
                </div>
              ) : (
                <table className="lp-table">
                  <thead><tr><th>Commit</th><th>Status</th><th>Duration</th><th>Actions</th></tr></thead>
                  <tbody>
                    {deployments.map((dep, i) => (
                      <tr key={dep._id}>
                        <td>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{dep.commitMessage || 'Manual Deploy'}</div>
                          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                            {dep.commitSha?.slice(0,7)} · {dep.branch}
                            {i === 0 && <span className="lp-badge live" style={{ marginLeft: 8, fontSize: 10 }}>Production</span>}
                          </div>
                        </td>
                        <td><span className={`lp-badge ${dep.status}`}>{dep.status}</span></td>
                        <td style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 13 }}>
                          {dep.duration ? `${(dep.duration/1000).toFixed(1)}s` : '—'}
                        </td>
                        <td>
                          <button className="lp-btn-secondary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => viewLogs(dep)}>Logs</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

        {/* ── Build Logs ── */}
        {activeTab === 'logs' && (
          <div className="lp-terminal fade-in">
            <div className="lp-terminal-header">
              <div className="lp-terminal-dots">
                <div className="lp-terminal-dot" style={{ background: '#ff5f57' }} />
                <div className="lp-terminal-dot" style={{ background: '#ffbd2e' }} />
                <div className="lp-terminal-dot" style={{ background: '#28c840' }} />
              </div>
              <span>Build Output — {project.name}</span>
              {deploying && <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--accent-primary)' }}>
                <div className="loading-spinner" style={{ width: 12, height: 12, border: '2px solid rgba(56,189,248,0.2)', borderTopColor: 'var(--accent-primary)' }} />
                Live Stream
              </div>}
            </div>
            <div className="lp-terminal-body">
              {logs.length === 0 ? (
                <span style={{ opacity: 0.4 }}>Waiting for build output...</span>
              ) : logs.map((line, i) => <LogLine key={i} line={line} />)}
              <div ref={logsEndRef} />
            </div>
          </div>
        )}

        {/* ── Environment Variables ── */}
        {activeTab === 'env' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div className="lp-card" style={{ padding: 24 }}>
              <div className="flex-between" style={{ marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, marginBottom: 4 }}>Environment Variables</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Encrypted secrets injected at build and runtime.</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => setShowBulk(!showBulk)}>
                    {showBulk ? 'Manual' : '📋 Bulk Import'}
                  </button>
                </div>
              </div>

              {/* Add single */}
              {!showBulk && (
                <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
                  <input value={envKey} onChange={e => setEnvKey(e.target.value.toUpperCase())} placeholder="VARIABLE_NAME" className="lp-input lp-input-mono" style={{ flex: 1 }} />
                  <input value={envValue} onChange={e => setEnvValue(e.target.value)} placeholder="value" type="password" className="lp-input" style={{ flex: 2 }} />
                  <button className="lp-btn-primary" onClick={handleAddEnv} style={{ flexShrink: 0 }}>Add</button>
                </div>
              )}

              {/* Bulk import */}
              {showBulk && (
                <div style={{ marginBottom: 24 }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>Paste your .env file content below:</p>
                  <textarea
                    value={bulkEnv}
                    onChange={e => setBulkEnv(e.target.value)}
                    placeholder={`DATABASE_URL=mongodb://...\nAPI_KEY=secret123\nNODE_ENV=production`}
                    className="lp-input"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, height: 140 }}
                  />
                  <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
                    <button className="lp-btn-primary" onClick={handleBulkImport}>Import All</button>
                    <button className="lp-btn-secondary" onClick={() => { setShowBulk(false); setBulkEnv(''); }}>Cancel</button>
                  </div>
                </div>
              )}

              {/* Env list */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {envVars.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-dim)', fontSize: 13 }}>No environment variables set</div>
                ) : envVars.map(e => (
                  <div key={e._id} className="lp-env-row">
                    <span className="mono" style={{ color: 'var(--accent-primary)', fontWeight: 700, fontSize: 13, flex: 1 }}>{e.key}</span>
                    <span style={{ flex: 2, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)', letterSpacing: showVal[e._id] ? 0 : 4 }}>
                      {showVal[e._id] ? '(value hidden)' : '••••••••••••'}
                    </span>
                    <button onClick={() => setShowVal(prev => ({ ...prev, [e._id]: !prev[e._id] }))} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12 }}>
                      {showVal[e._id] ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => handleDeleteEnv(e.key)} style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>Remove</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Settings ── */}
        {activeTab === 'settings' && (
          <div className="fade-in" style={{ display: 'grid', gap: 20, maxWidth: 700 }}>
            <div className="lp-card" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, marginBottom: 6 }}>Build Configuration</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>Override the default install/build commands for this project.</p>

              <div style={{ display: 'grid', gap: 20 }}>
                {[
                  { label: 'BRANCH', key: 'branch', placeholder: 'main' },
                  { label: 'INSTALL COMMAND', key: 'installCommand', placeholder: 'npm install', mono: true },
                  { label: 'BUILD COMMAND',   key: 'buildCommand',   placeholder: 'npm run build', mono: true },
                  { label: 'OUTPUT DIRECTORY',key: 'outputDir',      placeholder: 'dist', mono: true },
                ].map(({ label, key, placeholder, mono }) => (
                  <div key={key}>
                    <div className="lp-section-label">{label}</div>
                    <input
                      value={settings[key]}
                      onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                      placeholder={placeholder}
                      className={`lp-input${mono ? ' lp-input-mono' : ''}`}
                    />
                  </div>
                ))}

                <div className="flex-between" style={{ paddingTop: 8 }}>
                  {saveStatus === 'saved' && <div className="lp-status-bar success" style={{ padding: '6px 14px', fontSize: 12 }}>✓ Settings saved</div>}
                  {saveStatus === 'error' && <div className="lp-status-bar error" style={{ padding: '6px 14px', fontSize: 12 }}>Failed to save</div>}
                  {!saveStatus && <div />}
                  <button className="lp-btn-primary" onClick={handleSaveSettings} disabled={saveStatus === 'saving'}>
                    {saveStatus === 'saving' ? 'Saving...' : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>

            <div className="lp-card" style={{ padding: 28 }}>
              <h3 style={{ fontSize: 16, color: 'var(--accent-danger)', marginBottom: 8 }}>Danger Zone</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>Permanently delete this project and all its deployments. This action is irreversible.</p>
              <button className="lp-btn-danger" onClick={handleDeleteProject}>Delete Project</button>
            </div>
          </div>
        )}

        {/* ── Domains ── */}
        {activeTab === 'domains' && (
          <div className="fade-in">
            <DomainManager project={project} />
          </div>
        )}

        {/* ── Live Metrics ── */}
        {activeTab === 'metrics' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {[
                { label: 'Total Deployments', value: deployments.length },
                { label: 'Successful', value: deployments.filter(d => d.status === 'success').length, color: 'var(--accent-success)' },
                { label: 'Failed', value: deployments.filter(d => d.status === 'failed').length, color: 'var(--accent-danger)' },
                { label: 'Avg. Build Time', value: deployments.length ? `${(deployments.filter(d=>d.duration).reduce((a,d)=>a+d.duration,0)/deployments.filter(d=>d.duration).length/1000||0).toFixed(1)}s` : '—' },
              ].map(m => (
                <div key={m.label} className="lp-card" style={{ padding: '20px 24px' }}>
                  <div className="lp-section-label">{m.label}</div>
                  <div style={{ fontSize: 32, fontWeight: 800, color: m.color || 'var(--text-main)', marginTop: 4 }}>{m.value}</div>
                </div>
              ))}
            </div>
            <MetricsChart projectId={id} />
          </div>
        )}

        {/* ── Edge Analytics ── */}
        {activeTab === 'analytics' && (
          <div className="fade-in">
            <AnalyticsDashboard projectId={id} />
          </div>
        )}

        {/* ── Team Permissions ── */}
        {activeTab === 'team' && (
          <div className="fade-in">
            <TeamManager project={project} currentUser={user} />
          </div>
        )}

        {/* ── AI Co-Pilot ── */}
        {activeTab === 'ai' && (
          <div className="fade-in">
            <AIChat projectId={id} />
          </div>
        )}
      </main>
    </div>
  );
}