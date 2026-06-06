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
  { id: 'deployments', label: '🚀 Deployments' },
  { id: 'logs',        label: '📋 Build Logs' },
  { id: 'runtime-logs',label: '🖥️ Runtime Logs' },
  { id: 'advisor',     label: '🧠 AI Advisor' },
  { id: 'security',    label: '🛡️ Security' },
  { id: 'previews',   label: '🔍 PR Previews' },
  { id: 'env',         label: '🔐 Environment' },
  { id: 'domains',     label: '🌐 Domains' },
  { id: 'metrics',     label: '📊 Live Metrics' },
  { id: 'analytics',   label: '📈 Analytics' },
  { id: 'team',        label: '👥 Team' },
  { id: 'ai',          label: '🤖 AI Co-Pilot' },
  { id: 'settings',    label: '⚙️ Settings' },
];

function LogLine({ line }) {
  let cls = '';
  if (
    /❌|🛑|🤖|diagnosis|root\s+cause|quick\s+fix|detected\s+issue|suggested\s+commands|🛠️|💻|\bfix:/i.test(line) ||
    /\b(error|errors|fail|failed|failure|failures|abort|aborted|crash|crashing|exception|invalid|missing|cannot|could\s+not|unable|issue|issues|not\s+found|not\s+exist|does\s+not\s+exist|not\s+a\s+file|exit\s+code\s+[^0])\b/i.test(line) ||
    /^\s*\$/i.test(line)
  ) {
    cls = 'lp-log-error';
  } else if (/⚠️|\b(warn|warning|warnings)\b/i.test(line)) {
    cls = 'lp-log-warn';
  } else if (/✅|\b(success|successful|done|built|complete|ready)\b/i.test(line)) {
    cls = 'lp-log-success';
  } else if (/📦|📝|🔍|🐳|\b(phase|cloning|pulling|building)\b/i.test(line)) {
    cls = 'lp-log-step';
  } else if (/🚀|\b(live|deployed)\b/i.test(line)) {
    cls = 'lp-log-info';
  }
  return <div className={cls}>{line}</div>;
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [project,     setProject]     = useState(null);
  const [deployments, setDeployments] = useState([]);
  const [logs,        setLogs]        = useState([]);
  const [runtimeLogs, setRuntimeLogs] = useState([]);
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
  const [aiScanning, setAiScanning] = useState(false);

  // Settings
  const [settings, setSettings] = useState({ installCommand: '', buildCommand: '', outputDir: '', branch: '', autoHeal: false, autoHealStrategy: 'push-on-success' });
  const [activeDeployment, setActiveDeployment] = useState(null);
  const [showDiff, setShowDiff] = useState(false);

  // SRE Container Limits
  const [cpuLimit, setCpuLimit] = useState(0.5);
  const [ramLimitMB, setRamLimitMB] = useState(256);
  const [resizing, setResizing] = useState(false);

  // 🛡️ Security / Vulnerability Scanner
  const [vulnData, setVulnData] = useState(null);
  const [vulnLoading, setVulnLoading] = useState(false);
  const [vulnFixData, setVulnFixData] = useState(null);
  const [vulnFixLoading, setVulnFixLoading] = useState(false);

  // 🧠 AI Deployment Advisor (Readiness)
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);

  // 📊 Build Performance Trends
  const [buildTrends, setBuildTrends] = useState(null);
  const [trendsLoading, setTrendsLoading] = useState(false);

  // 💰 Cost Estimator
  const [costData, setCostData] = useState(null);
  const [costLoading, setCostLoading] = useState(false);

  // 🫀 Runtime Health Monitor
  const [healthData, setHealthData] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);

  // ⏮️ Rollback
  const [rollingBack, setRollingBack] = useState(null); // deploymentId being rolled back

  // 🔍 PR Preview Environments
  const [previews, setPreviews] = useState([]);
  const [previewsLoading, setPreviewsLoading] = useState(false);
  const [newPreviewPR, setNewPreviewPR] = useState('');
  const [newPreviewBranch, setNewPreviewBranch] = useState('');
  const [creatingPreview, setCreatingPreview] = useState(false);

  // 🔐 Env Vault — AI missing variable scanner
  const [missingVars, setMissingVars] = useState(null); // null = not scanned, [] = none found
  const [missingVarsLoading, setMissingVarsLoading] = useState(false);
  const [addingMissingVar, setAddingMissingVar] = useState(null); // key being added

  const logsEndRef = useRef(null);
  const runtimeLogsEndRef = useRef(null);
  const socketRef  = useRef(null);
  const pollRef    = useRef(null);

  const loadProject = useCallback(async () => {
    try {
      const r = await api.get(`/projects/${id}`);
      const p = r.data.project;
      setProject(p);
      setCpuLimit(p.cpuLimit || 0.5);
      setRamLimitMB(p.ramLimitMB || 256);
      setSettings({
        installCommand: p.installCommand || '',
        buildCommand:   p.buildCommand   || '',
        outputDir:      p.outputDir      || '',
        branch:         p.branch         || 'main',
        autoHeal:       !!p.autoHeal,
        autoHealStrategy: p.autoHealStrategy || 'push-on-success',
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

  // Auto-load latest deployment logs when switching to Build Logs tab, or connect to runtime logs
  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      // If no logs yet and we're not mid-deploy, load the latest deployment's logs
      if (logs.length === 0 && !deploying && deployments.length > 0) {
        viewLogs(deployments[0]);
      }
    } else if (activeTab === 'runtime-logs') {
      connectToRuntimeLogs();
    } else {
      socketRef.current?.disconnect();
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === 'logs') logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  useEffect(() => {
    if (activeTab === 'runtime-logs') runtimeLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [runtimeLogs]);

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

  const connectToRuntimeLogs = () => {
    socketRef.current?.disconnect();
    setRuntimeLogs([]);

    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
    });
    socket.emit('join:runtime-logs', id);
    socket.on('runtime-log', ({ line }) => {
      setRuntimeLogs(prev => [...prev, line]);
    });
    socket.on('connect_error', (err) => console.warn('Runtime socket error:', err.message));
    socketRef.current = socket;
  };

  const handleDeploy = async () => {
    setDeploying(true); setError(''); setActiveTab('logs'); setLogs([]);
    setActiveDeployment(null);
    setShowDiff(false);
    try {
      const res = await api.post(`/deploy/${id}`);
      setActiveDeployment(res.data.deployment);
      connectToLogs(res.data.deployment._id);
      pollRef.current = setInterval(async () => {
        const r = await api.get(`/deploy/${id}`);
        setDeployments(r.data.deployments || []);
        const latest = r.data.deployments?.[0];
        if (latest) {
          try {
            const detailRes = await api.get(`/deploy/${id}/${latest._id}`);
            setActiveDeployment(detailRes.data.deployment);
          } catch {}
        }
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
    setActiveDeployment(dep);
    setShowDiff(false);
    try {
      const res = await api.get(`/deploy/${id}/${dep._id}`);
      const fetched = res.data.deployment;
      setLogs(fetched?.logs || []);
      setActiveDeployment(fetched);
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

  const handleAiAutoDetect = async () => {
    setAiScanning(true);
    setError('');
    try {
      const res = await api.post(`/ai/${id}/discover-env`);
      if (res.data.detectedVars && res.data.detectedVars.length > 0) {
        loadEnvVars();
        alert(`Successfully auto-detected and configured ${res.data.detectedVars.length} variables!`);
      } else {
        alert("No new environment variables detected in the codebase.");
      }
    } catch (err) {
      setError(err.response?.data?.message || 'AI detection failed');
    } finally {
      setAiScanning(false);
    }
  };

  const handleEditClick = (key) => {
    setEnvKey(key);
    setEnvValue('');
    setShowBulk(false);
    setTimeout(() => {
      const valInput = document.querySelector('input[placeholder="value"]');
      if (valInput) valInput.focus();
    }, 50);
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

  const handleResizeLimits = async () => {
    setResizing(true);
    setError('');
    try {
      const res = await api.post(`/projects/${id}/resize-limits`, {
        cpuLimit: parseFloat(cpuLimit),
        ramLimitMB: parseInt(ramLimitMB)
      });
      alert(res.data.message || 'Container capacity limits resized successfully!');
      loadProject();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to apply new resource limits');
    } finally {
      setResizing(false);
    }
  };

  // ⏪ Rollback to a specific past deployment
  const handleRollback = async (dep) => {
    if (!window.confirm(`Roll back to deployment from ${new Date(dep.createdAt).toLocaleDateString()}? Current live version will be replaced.`)) return;
    setRollingBack(dep._id);
    setError('');
    try {
      const res = await api.post(`/deploy/${id}/rollback/${dep._id}`);
      setActiveTab('logs');
      setLogs([]);
      connectToLogs(res.data.deployment._id);
      loadDeployments();
    } catch (err) {
      setError(err.response?.data?.message || 'Rollback failed');
    } finally {
      setRollingBack(null);
    }
  };

  // 🛡️ Run vulnerability scan
  const handleVulnScan = async () => {
    setVulnLoading(true);
    setVulnData(null);
    setVulnFixData(null);
    try {
      const res = await api.get(`/vuln/${id}`);
      setVulnData(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Vulnerability scan failed');
    } finally {
      setVulnLoading(false);
    }
  };

  // 🧠 Run readiness check
  const handleReadinessCheck = async () => {
    setReadinessLoading(true);
    setReadiness(null);
    try {
      const res = await api.post(`/projects/${id}/readiness`);
      setReadiness(res.data);
    } catch (err) {
      setError(err.response?.data?.message || 'Readiness check failed');
    } finally {
      setReadinessLoading(false);
    }
  };

  // 📊 Load build trends
  const handleLoadTrends = async () => {
    setTrendsLoading(true);
    try {
      const res = await api.get(`/analytics/${id}/build-trends`);
      setBuildTrends(res.data);
    } catch (err) {
      console.warn('Build trends unavailable:', err.message);
    } finally {
      setTrendsLoading(false);
    }
  };

  // 💰 Load cost estimate
  const handleLoadCostEstimate = async () => {
    setCostLoading(true);
    try {
      const res = await api.get(`/metrics/${id}/cost-estimate`);
      setCostData(res.data);
    } catch (err) {
      console.warn('Cost estimate unavailable:', err.message);
    } finally {
      setCostLoading(false);
    }
  };

  // 🫀 Load runtime health
  const handleLoadHealth = async () => {
    setHealthLoading(true);
    try {
      const res = await api.get(`/health/${id}`);
      setHealthData(res.data);
    } catch (err) {
      console.warn('Health status unavailable:', err.message);
    } finally {
      setHealthLoading(false);
    }
  };

  // Generate vulnerability AI fix commands
  const handleVulnAutoFix = async () => {
    setVulnFixLoading(true);
    try {
      const res = await api.post(`/vuln/${id}/auto-fix`);
      setVulnFixData(res.data.fixPatch);
    } catch (err) {
      setError(err.response?.data?.message || 'Auto-fix generation failed');
    } finally {
      setVulnFixLoading(false);
    }
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
          {/* Health Score Pill */}
          {project.lastHealthScore !== undefined && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: project.lastHealthScore >= 80 ? 'rgba(52,211,153,0.15)' : project.lastHealthScore >= 50 ? 'rgba(251,191,36,0.15)' : 'rgba(248,113,113,0.15)',
              color: project.lastHealthScore >= 80 ? '#34d399' : project.lastHealthScore >= 50 ? '#fbbf24' : '#f87171',
              border: `1px solid ${project.lastHealthScore >= 80 ? 'rgba(52,211,153,0.3)' : project.lastHealthScore >= 50 ? 'rgba(251,191,36,0.3)' : 'rgba(248,113,113,0.3)'}`,
              cursor: 'pointer',
            }} onClick={() => { setActiveTab('runtime-logs'); handleLoadHealth(); }} title="Click to view health status">
              {project.lastHealthScore >= 80 ? '🟢' : project.lastHealthScore >= 50 ? '🟡' : '🔴'}
              Health {project.lastHealthScore}%
            </span>
          )}
          {/* Vuln Summary Pill */}
          {project.vulnSummary && (project.vulnSummary.critical > 0 || project.vulnSummary.high > 0) && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 5,
              padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 700,
              background: 'rgba(248,113,113,0.15)', color: '#f87171',
              border: '1px solid rgba(248,113,113,0.3)',
              cursor: 'pointer',
            }} onClick={() => setActiveTab('security')} title="Click to view vulnerabilities">
              ⚠️ {project.vulnSummary.critical} Critical · {project.vulnSummary.high} High CVEs
            </span>
          )}
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
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>Deployment Timeline</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>Click any past deployment to rollback. Production is always the top entry.</p>
                </div>
                <button className="lp-btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => { handleLoadTrends(); setActiveTab('analytics'); }}>
                  📈 View Build Trends
                </button>
              </div>
              {deployments.length === 0 ? (
                <div className="flex-center" style={{ padding: 60, flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontSize: 32 }}>🚀</div>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>No deployments yet. Click Redeploy to start.</p>
                </div>
              ) : (
                <div style={{ padding: '8px 0' }}>
                  {deployments.map((dep, i) => {
                    const isProduction = i === 0 && dep.status === 'success';
                    const isRollingBackThis = rollingBack === dep._id;
                    return (
                      <div key={dep._id} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 0,
                        padding: '16px 24px',
                        borderBottom: i < deployments.length - 1 ? '1px solid var(--border)' : 'none',
                        background: isProduction ? 'rgba(52,211,153,0.03)' : 'transparent',
                        transition: 'background 0.2s',
                      }}>
                        {/* Timeline dot + line */}
                        <div style={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 4 }}>
                          <div style={{
                            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                            background: dep.status === 'success' ? '#34d399' : dep.status === 'failed' ? '#f87171' : dep.status === 'building' ? '#38bdf8' : '#64748b',
                            boxShadow: dep.status === 'success' ? '0 0 8px rgba(52,211,153,0.5)' : dep.status === 'failed' ? '0 0 8px rgba(248,113,113,0.4)' : 'none',
                          }} />
                          {i < deployments.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 32, background: 'var(--border)', marginTop: 4 }} />}
                        </div>

                        {/* Deployment info */}
                        <div style={{ flex: 1, paddingLeft: 12 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{dep.commitMessage || 'Manual Deploy'}</span>
                            <span className={`lp-badge ${dep.status}`} style={{ fontSize: 11 }}>{dep.status}</span>
                            {isProduction && <span className="lp-badge live" style={{ fontSize: 10 }}>⚡ Production</span>}
                            {dep.isAutoHeal && <span className="lp-badge" style={{ fontSize: 10, background: 'rgba(56,189,248,0.1)', color: 'var(--accent-info)', border: '1px solid rgba(56,189,248,0.2)' }} title={dep.autoHealFixDescription}>🤖 AI Healed</span>}
                            {dep.rollbackFrom && <span className="lp-badge" style={{ fontSize: 10, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>🔄 Rollback</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' }}>
                            {dep.commitSha && <span>{dep.commitSha.slice(0, 7)}</span>}
                            {dep.branch && <span>↳ {dep.branch}</span>}
                            {dep.duration && <span>⏱ {(dep.duration / 1000).toFixed(1)}s</span>}
                            <span>{new Date(dep.createdAt).toLocaleString()}</span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center' }}>
                          <button className="lp-btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => viewLogs(dep)}>Logs</button>
                          {!isProduction && dep.status === 'success' && (
                            <button
                              className="lp-btn-secondary"
                              style={{ padding: '5px 12px', fontSize: 12, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24' }}
                              onClick={() => handleRollback(dep)}
                              disabled={isRollingBackThis || !!rollingBack}
                            >
                              {isRollingBackThis ? '↩ Rolling...' : '↩ Rollback'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Build Logs ── */}
        {activeTab === 'logs' && (
          <div className="fade-in" style={{ display: 'grid', gap: 20 }}>
            {activeDeployment && activeDeployment.isAutoHeal && activeDeployment.autoHealDiff && (
              <div className="lp-card glass" style={{ 
                padding: '20px 24px', 
                borderLeft: '4px solid var(--accent-info)',
                background: 'rgba(56, 189, 248, 0.04)',
                borderRadius: 16
              }}>
                <div className="flex-between">
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                      🤖 AI Auto-Healing Active Fix
                    </h4>
                    <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 4 }}>
                      {activeDeployment.autoHealFixDescription}
                    </p>
                  </div>
                  <button 
                    className="lp-btn-secondary" 
                    style={{ padding: '6px 14px', fontSize: 11 }}
                    onClick={() => setShowDiff(d => !d)}
                  >
                    {showDiff ? 'Hide Patch Diff' : 'View Code Patch Diff'}
                  </button>
                </div>
                {showDiff && (
                  <pre style={{ 
                    marginTop: 16, 
                    padding: 16, 
                    background: '#090d16', 
                    borderRadius: 12, 
                    border: '1px solid var(--border)',
                    fontFamily: 'var(--font-mono)', 
                    fontSize: 11, 
                    color: '#cbd5e1',
                    overflowX: 'auto',
                    whiteSpace: 'pre-wrap'
                  }}>
                    {activeDeployment.autoHealDiff}
                  </pre>
                )}

                {/* ── SRE Auto-Healing Audit Trail Timeline ── */}
                {activeDeployment.autoHealAuditTrail && activeDeployment.autoHealAuditTrail.length > 0 && (
                  <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                    <div className="lp-section-label" style={{ marginBottom: 12 }}>SRE AUTO-HEALING TIMELINE</div>
                    <div style={{ display: 'grid', gap: 14, position: 'relative', paddingLeft: 16 }}>
                      {/* Vertical line indicator */}
                      <div style={{ 
                        position: 'absolute', 
                        left: 4, 
                        top: 8, 
                        bottom: 8, 
                        width: 2, 
                        background: 'var(--border)' 
                      }} />
                      
                      {activeDeployment.autoHealAuditTrail.map((step, idx) => {
                        const statusColors = {
                          success: '#34d399',
                          failure: '#f87171',
                          info: '#818cf8'
                        };
                        const color = statusColors[step.status] || 'var(--text-dim)';
                        
                        return (
                          <div key={idx} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative' }}>
                            {/* Dot indicator */}
                            <div style={{ 
                              position: 'absolute',
                              left: -20,
                              top: 5,
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              background: color,
                              border: '2px solid var(--bg-primary)',
                              boxShadow: `0 0 8px ${color}`
                            }} />
                            
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)' }}>{step.step}</span>
                                <span style={{ fontSize: 11, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)' }}>
                                  {new Date(step.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>
                              <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>{step.details}</p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="lp-terminal">
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
          </div>
        )}

        {/* ── Runtime Logs ── */}
        {activeTab === 'runtime-logs' && (
          <div className="lp-terminal fade-in">
            <div className="lp-terminal-header">
              <div className="lp-terminal-dots">
                <div className="lp-terminal-dot" style={{ background: '#ff5f57' }} />
                <div className="lp-terminal-dot" style={{ background: '#ffbd2e' }} />
                <div className="lp-terminal-dot" style={{ background: '#28c840' }} />
              </div>
              <span>Container stdout/stderr — {project.name}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981', display: 'inline-block', animation: 'pulse-dot 2s infinite' }}></div>
                Live Stream
              </div>
            </div>
            <div className="lp-terminal-body" style={{ maxHeight: '500px', overflowY: 'auto' }}>
              {runtimeLogs.length === 0 ? (
                <span style={{ opacity: 0.4 }}>Waiting for runtime log stream...</span>
              ) : runtimeLogs.map((line, i) => (
                <div key={i} style={{ fontFamily: 'var(--font-mono)', fontSize: '11.5px', color: '#e2e8f0', lineHeight: 1.5 }}>{line}</div>
              ))}
              <div ref={runtimeLogsEndRef} />
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
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13, background: 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(59,130,246,0.1) 100%)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8' }} onClick={handleAiAutoDetect} disabled={aiScanning}>
                    {aiScanning ? 'Scanning...' : '🔍 AI Auto-Detect'}
                  </button>
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
                    <button onClick={() => setShowVal(prev => ({ ...prev, [e._id]: !prev[e._id] }))} style={{ background: 'none', border: 'none', color: 'var(--text-dim)', cursor: 'pointer', fontSize: 12, marginRight: 8 }}>
                      {showVal[e._id] ? 'Hide' : 'Show'}
                    </button>
                    <button onClick={() => handleEditClick(e.key)} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', fontSize: 12, fontWeight: 600, marginRight: 8 }}>Edit</button>
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

            <div className="lp-card glass" style={{ 
              padding: 28,
              borderLeft: '4px solid var(--accent-secondary)',
              background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.05) 0%, rgba(56, 189, 248, 0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                ⚡ SRE Zero-Downtime Container Scaling
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                Scale container capacity boundaries on-the-fly. This triggers an automated hot-swap rebuild with zero service downtime.
              </p>

              <div style={{ display: 'grid', gap: 24 }}>
                <div>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <div className="lp-section-label" style={{ margin: 0 }}>CPU ALLOCATION</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-secondary)' }}>
                      {cpuLimit} Cores
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="0.1" 
                    max="2.0" 
                    step="0.1"
                    value={cpuLimit} 
                    onChange={e => setCpuLimit(parseFloat(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent-secondary)' }}
                  />
                  <div className="flex-between" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                    <span>0.1 Cores (Micro)</span>
                    <span>1.0 Cores (Standard)</span>
                    <span>2.0 Cores (Production)</span>
                  </div>
                </div>

                <div>
                  <div className="flex-between" style={{ marginBottom: 8 }}>
                    <div className="lp-section-label" style={{ margin: 0 }}>RAM ALLOCATION</div>
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent-secondary)' }}>
                      {ramLimitMB} MB
                    </span>
                  </div>
                  <input 
                    type="range" 
                    min="128" 
                    max="1024" 
                    step="128"
                    value={ramLimitMB} 
                    onChange={e => setRamLimitMB(parseInt(e.target.value))}
                    style={{ width: '100%', accentColor: 'var(--accent-secondary)' }}
                  />
                  <div className="flex-between" style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4 }}>
                    <span>128 MB</span>
                    <span>512 MB</span>
                    <span>1024 MB</span>
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
                  <button 
                    className="lp-btn-primary" 
                    onClick={handleResizeLimits} 
                    disabled={resizing}
                    style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: 8, 
                      padding: '12px 24px',
                      background: 'var(--accent-secondary)',
                      boxShadow: '0 0 20px rgba(129, 140, 248, 0.2)'
                    }}
                  >
                    {resizing ? (
                      <>
                        <div className="loading-spinner" style={{ width: 16, height: 16, borderColor: '#fff', borderTopColor: 'transparent' }} />
                        Executing Hot-Swap...
                      </>
                    ) : (
                      <>⚡ Apply SRE Resize Limits</>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="lp-card glass" style={{ 
              padding: 28,
              borderLeft: '4px solid var(--accent-info)',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                🤖 AI Auto-Healing & Self-Correction
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                When enabled, LaunchPad AI automatically intercepts deployment/health check failures, analyzes the logs, patches your code files locally, and re-runs the build.
              </p>

              <div style={{ display: 'grid', gap: 20 }}>
                <div className="flex-between">
                  <div className="lp-section-label" style={{ margin: 0 }}>ENABLE AI AUTO-HEALING</div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.autoHeal} 
                      onChange={e => setSettings(s => ({ ...s, autoHeal: e.target.checked }))}
                      style={{ width: 40, height: 20, accentColor: 'var(--accent-info)', cursor: 'pointer' }}
                    />
                  </label>
                </div>

                {settings.autoHeal && (
                  <div className="fade-in" style={{ display: 'grid', gap: 8 }}>
                    <div className="lp-section-label" style={{ margin: 0 }}>COMMIT & PUSH STRATEGY</div>
                    <select
                      value={settings.autoHealStrategy}
                      onChange={e => setSettings(s => ({ ...s, autoHealStrategy: e.target.value }))}
                      className="lp-input"
                      style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                    >
                      <option value="push-on-success">Push on Success (Recommended)</option>
                      <option value="pr">Create Pull Request (PR)</option>
                      <option value="local-only">Local Patch Only (Do not push to GitHub)</option>
                    </select>
                    <p style={{ color: 'var(--text-dim)', fontSize: 11, marginTop: 4 }}>
                      {settings.autoHealStrategy === 'push-on-success' && 'AI will verify the fix first, and only push back to GitHub once the build is 100% healthy.'}
                      {settings.autoHealStrategy === 'pr' && 'AI will verify the fix, push to a new branch, and open a GitHub Pull Request.'}
                      {settings.autoHealStrategy === 'local-only' && 'AI patches the local container to make it live, but leaves GitHub untouched.'}
                    </p>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
                  <button className="lp-btn-primary" onClick={handleSaveSettings} disabled={saveStatus === 'saving'}>
                    {saveStatus === 'saving' ? 'Saving Auto-Heal Settings...' : 'Save Auto-Heal Configuration'}
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
            <DomainManager project={project} onUpdate={loadProject} />
          </div>
        )}

        {/* ── Live Metrics + Cost Estimator ── */}
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

            {/* 💰 Cost Estimator Card */}
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid #a78bfa', background: 'linear-gradient(135deg, rgba(167,139,250,0.06) 0%, rgba(56,189,248,0.03) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>💰 Monthly Cost Estimator</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>AI analysis of your CPU/RAM usage patterns to predict VPS costs.</p>
                </div>
                <button className="lp-btn-secondary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={handleLoadCostEstimate} disabled={costLoading}>
                  {costLoading ? 'Analyzing...' : '🔄 Run Estimate'}
                </button>
              </div>
              {costLoading && <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)' }}><div className="loading-spinner" style={{ width: 16, height: 16 }} /> Analyzing usage patterns...</div>}
              {costData && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 }}>
                    {[
                      { label: 'Current Monthly Cost', value: `$${costData.currentMonthlyCostUSD}`, color: '#34d399' },
                      { label: 'Projected (next month)', value: `$${costData.projectedCostUSD}`, color: '#fbbf24' },
                      { label: 'Avg CPU Usage', value: `${costData.avgCpuPercent}%`, color: 'var(--accent-primary)' },
                      { label: 'Avg RAM Usage', value: `${costData.avgRamMB} MB`, color: 'var(--accent-secondary)' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '16px 20px', background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border)' }}>
                        <div className="lp-section-label">{s.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
                    <div className="lp-section-label" style={{ marginBottom: 8 }}>COST BREAKDOWN</div>
                    <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--text-muted)' }}>
                      <span>Base: <strong style={{ color: 'var(--text-main)' }}>${costData.breakdown?.base}</strong></span>
                      <span>CPU: <strong style={{ color: 'var(--text-main)' }}>${costData.breakdown?.cpu}</strong></span>
                      <span>RAM: <strong style={{ color: 'var(--text-main)' }}>${costData.breakdown?.ram}</strong></span>
                    </div>
                  </div>
                  <div className="lp-section-label" style={{ marginBottom: 8 }}>AI RECOMMENDATIONS</div>
                  {costData.recommendations?.map((r, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>
                      <span style={{ color: '#a78bfa', flexShrink: 0 }}>•</span>
                      <span>{r}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Edge Analytics + Build Trends ── */}
        {activeTab === 'analytics' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <AnalyticsDashboard projectId={id} />

            {/* Build Performance Trends */}
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid #38bdf8', background: 'linear-gradient(135deg, rgba(56,189,248,0.05) 0%, rgba(129,140,248,0.02) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>📊 Build Performance Trends</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Track build duration, success rate, and get AI optimization tips.</p>
                </div>
                <button className="lp-btn-secondary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={handleLoadTrends} disabled={trendsLoading}>
                  {trendsLoading ? 'Analyzing...' : '🔄 Analyze Trends'}
                </button>
              </div>
              {trendsLoading && <div style={{ display: 'flex', gap: 10, alignItems: 'center', color: 'var(--text-muted)' }}><div className="loading-spinner" style={{ width: 16, height: 16 }} /> Analyzing build history...</div>}
              {buildTrends && (
                <div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 20 }}>
                    {[
                      { label: 'Avg Build Time', value: buildTrends.avgBuildTimeMs ? `${(buildTrends.avgBuildTimeMs/1000).toFixed(1)}s` : 'N/A', color: 'var(--accent-primary)' },
                      { label: 'Success Rate', value: `${buildTrends.successRate}%`, color: buildTrends.successRate >= 80 ? '#34d399' : buildTrends.successRate >= 50 ? '#fbbf24' : '#f87171' },
                      { label: 'Total Builds', value: buildTrends.totalBuilds || 0, color: 'var(--text-main)' },
                      { label: 'Trend', value: buildTrends.trend === 'improving' ? '↑ Improving' : buildTrends.trend === 'degrading' ? '↓ Degrading' : '→ Stable', color: buildTrends.trend === 'improving' ? '#34d399' : buildTrends.trend === 'degrading' ? '#f87171' : '#fbbf24' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '16px 20px', background: 'var(--bg-secondary)', borderRadius: 12, border: '1px solid var(--border)' }}>
                        <div className="lp-section-label">{s.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  {buildTrends.tips?.length > 0 && (
                    <div>
                      <div className="lp-section-label" style={{ marginBottom: 8 }}>AI OPTIMIZATION TIPS</div>
                      {buildTrends.tips.map((tip, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8, padding: '10px 14px', background: 'rgba(56,189,248,0.05)', borderRadius: 8, border: '1px solid rgba(56,189,248,0.15)' }}>
                          <span style={{ fontSize: 16, flexShrink: 0 }}>💡</span>
                          <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{tip}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Security Scanner ── */}
        {activeTab === 'security' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid #f87171', background: 'linear-gradient(135deg, rgba(248,113,113,0.05) 0%, rgba(251,191,36,0.02) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>🛡️ Dependency Vulnerability Scanner</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Powered by OSV.dev — scans your package.json against the global CVE database.</p>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  {vulnData && vulnData.packages?.some(p => p.vulns.some(v => v.severity === 'critical' || v.severity === 'high')) && (
                    <button className="lp-btn-secondary" style={{ padding: '7px 16px', fontSize: 13, background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }} onClick={handleVulnAutoFix} disabled={vulnFixLoading}>
                      {vulnFixLoading ? '🔄 Generating...' : '🤖 AI Auto-Fix Critical'}
                    </button>
                  )}
                  <button className="lp-btn-primary" style={{ padding: '7px 16px', fontSize: 13 }} onClick={handleVulnScan} disabled={vulnLoading}>
                    {vulnLoading ? 'Scanning...' : '🔍 Run CVE Scan'}
                  </button>
                </div>
              </div>

              {vulnLoading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 20, color: 'var(--text-muted)' }}>
                  <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                  Querying OSV.dev vulnerability database...
                </div>
              )}

              {vulnData && !vulnLoading && (
                <div>
                  {/* Summary Cards */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
                    {[
                      { label: 'Critical', count: vulnData.summary?.critical || 0, color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
                      { label: 'High', count: vulnData.summary?.high || 0, color: '#fb923c', bg: 'rgba(251,146,60,0.1)' },
                      { label: 'Medium', count: vulnData.summary?.medium || 0, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
                      { label: 'Low', count: vulnData.summary?.low || 0, color: '#34d399', bg: 'rgba(52,211,153,0.1)' },
                    ].map(s => (
                      <div key={s.label} style={{ padding: '16px 20px', background: s.bg, borderRadius: 12, border: `1px solid ${s.color}30`, textAlign: 'center' }}>
                        <div style={{ fontSize: 32, fontWeight: 800, color: s.color }}>{s.count}</div>
                        <div style={{ fontSize: 12, color: s.color, fontWeight: 600, marginTop: 4 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>

                  {/* Vulnerable Packages */}
                  {vulnData.packages?.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '32px 0', color: '#34d399', fontSize: 15 }}>✅ No known vulnerabilities found in your dependencies!</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                      {vulnData.packages?.map(pkg => (
                        <div key={pkg.name} style={{ background: 'var(--bg-secondary)', borderRadius: 12, padding: '16px 20px', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14 }}>{pkg.name}</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>v{pkg.version}</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{pkg.vulns.length} issue{pkg.vulns.length !== 1 ? 's' : ''}</span>
                          </div>
                          {pkg.vulns.map(v => (
                            <div key={v.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8, padding: '10px 12px', background: 'var(--bg-primary)', borderRadius: 8, border: `1px solid ${{ critical: 'rgba(248,113,113,0.3)', high: 'rgba(251,146,60,0.3)', medium: 'rgba(251,191,36,0.3)', low: 'rgba(52,211,153,0.2)' }[v.severity] || 'var(--border)'}` }}>
                              <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, background: { critical: 'rgba(248,113,113,0.2)', high: 'rgba(251,146,60,0.2)', medium: 'rgba(251,191,36,0.2)', low: 'rgba(52,211,153,0.15)' }[v.severity], color: { critical: '#f87171', high: '#fb923c', medium: '#fbbf24', low: '#34d399' }[v.severity], flexShrink: 0, textTransform: 'uppercase' }}>{v.severity}</span>
                              <div style={{ flex: 1 }}>
                                <div style={{ fontSize: 13, color: 'var(--text-main)', marginBottom: 2 }}>{v.summary}</div>
                                <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text-dim)' }}>
                                  <a href={v.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)' }}>{v.id}</a>
                                  {v.fixedIn && <span>→ Fixed in v{v.fixedIn}</span>}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* AI Fix Commands */}
                  {vulnFixData && (
                    <div style={{ marginTop: 20, padding: 20, background: 'rgba(52,211,153,0.05)', borderRadius: 12, border: '1px solid rgba(52,211,153,0.2)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <span style={{ fontSize: 16 }}>🤖</span>
                        <span style={{ fontWeight: 700, fontSize: 14, color: '#34d399' }}>AI-Generated Security Fix Commands</span>
                      </div>
                      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>{vulnFixData.description}</p>
                      <pre style={{ background: '#090d16', borderRadius: 8, padding: 16, fontFamily: 'var(--font-mono)', fontSize: 12, color: '#e2e8f0', overflowX: 'auto' }}>
                        {vulnFixData.patchCommands?.join('\n') || 'No specific commands generated.'}
                      </pre>
                    </div>
                  )}

                  <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 16 }}>Last scanned: {vulnData.scannedAt ? new Date(vulnData.scannedAt).toLocaleString() : 'Just now'}</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AI Deployment Advisor ── */}
        {activeTab === 'advisor' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="lp-card glass" style={{ padding: 28, borderLeft: '4px solid #818cf8', background: 'linear-gradient(135deg, rgba(129,140,248,0.06) 0%, rgba(56,189,248,0.03) 100%)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>🧠 AI Deployment Readiness Advisor</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Analyzes your repository and scores deployment readiness 0–100 before you go live.</p>
                </div>
                <button className="lp-btn-primary" style={{ padding: '7px 18px', fontSize: 13, background: 'var(--accent-secondary)', boxShadow: '0 0 20px rgba(129,140,248,0.25)' }} onClick={handleReadinessCheck} disabled={readinessLoading}>
                  {readinessLoading ? 'Analyzing...' : '⚡ Run Readiness Check'}
                </button>
              </div>

              {readinessLoading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: 20, color: 'var(--text-muted)' }}>
                  <div className="loading-spinner" style={{ width: 20, height: 20 }} />
                  Analyzing repository structure...
                </div>
              )}

              {readiness && !readinessLoading && (
                <div>
                  {/* Score Display */}
                  <div style={{ display: 'flex', gap: 32, alignItems: 'center', marginBottom: 28, padding: '24px 28px', background: 'var(--bg-secondary)', borderRadius: 16, border: '1px solid var(--border)' }}>
                    {/* Animated score circle */}
                    <div style={{ position: 'relative', width: 100, height: 100, flexShrink: 0 }}>
                      <svg width="100" height="100" viewBox="0 0 100 100">
                        <circle cx="50" cy="50" r="44" fill="none" stroke="rgba(129,140,248,0.15)" strokeWidth="10" />
                        <circle cx="50" cy="50" r="44" fill="none"
                          stroke={readiness.score >= 80 ? '#34d399' : readiness.score >= 50 ? '#fbbf24' : '#f87171'}
                          strokeWidth="10" strokeLinecap="round"
                          strokeDasharray={`${(readiness.score / 100) * 276.5} 276.5`}
                          transform="rotate(-90 50 50)" style={{ transition: 'stroke-dasharray 1s ease' }}
                        />
                      </svg>
                      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                        <span style={{ fontSize: 24, fontWeight: 900, color: readiness.score >= 80 ? '#34d399' : readiness.score >= 50 ? '#fbbf24' : '#f87171' }}>{readiness.score}</span>
                        <span style={{ fontSize: 10, color: 'var(--text-dim)' }}>/ 100</span>
                      </div>
                    </div>
                    <div>
                      <div style={{ fontSize: 20, fontWeight: 800, color: readiness.score >= 80 ? '#34d399' : readiness.score >= 50 ? '#fbbf24' : '#f87171', marginBottom: 6 }}>
                        {readiness.score >= 80 ? '🟢 Ready to Deploy' : readiness.score >= 50 ? '🟡 Needs Attention' : '🔴 Not Recommended'}
                      </div>
                      <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{readiness.passed} of {readiness.total} checks passed.</div>
                      {readiness.score < 80 && (
                        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-dim)' }}>Fix the issues below before deploying to production.</div>
                      )}
                    </div>
                  </div>

                  {/* Checklist */}
                  <div className="lp-section-label" style={{ marginBottom: 12 }}>READINESS CHECKLIST</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {readiness.checks?.map((check, i) => (
                      <div key={i} style={{
                        display: 'flex', gap: 14, alignItems: 'flex-start',
                        padding: '14px 18px', borderRadius: 12,
                        background: check.passed ? 'rgba(52,211,153,0.05)' : 'rgba(248,113,113,0.05)',
                        border: `1px solid ${check.passed ? 'rgba(52,211,153,0.2)' : 'rgba(248,113,113,0.2)'}`,
                      }}>
                        <span style={{ fontSize: 18, flexShrink: 0 }}>{check.passed ? '✅' : check.severity === 'critical' ? '🔴' : check.severity === 'high' ? '⚠️' : 'ℹ️'}</span>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{check.name}</span>
                            {!check.passed && (
                              <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                                background: check.severity === 'critical' ? 'rgba(248,113,113,0.2)' : check.severity === 'high' ? 'rgba(251,146,60,0.2)' : 'rgba(251,191,36,0.1)',
                                color: check.severity === 'critical' ? '#f87171' : check.severity === 'high' ? '#fb923c' : '#fbbf24',
                              }}>{check.severity}</span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{check.recommendation}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!readiness && !readinessLoading && (
                <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-dim)' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🧠</div>
                  <p style={{ fontSize: 14 }}>Click "Run Readiness Check" to analyze your repository.</p>
                  <p style={{ fontSize: 13, marginTop: 6 }}>This checks for health endpoints, error handling, security headers, and more.</p>
                </div>
              )}
            </div>
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