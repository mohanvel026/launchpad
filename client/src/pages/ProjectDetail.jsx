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

const SIDEBAR_GROUPS = [
  {
    title: 'Development',
    items: [
      { id: 'deployments',  label: 'Deployments',  icon: '🚀' },
      { id: 'logs',         label: 'Build Logs',   icon: '📋' },
      { id: 'runtime-logs', label: 'Runtime Logs',  icon: '🖥️' },
      { id: 'previews',     label: 'PR Previews',  icon: '🔍' },
    ]
  },
  {
    title: 'AI Assistant',
    items: [
      { id: 'ai',           label: 'AI Co-Pilot',  icon: '🤖' },
      { id: 'advisor',      label: 'AI Advisor',   icon: '🧠' },
      { id: 'guide',        label: 'How It Works', icon: '📖' },
    ]
  },
  {
    title: 'Monitoring',
    items: [
      { id: 'metrics',      label: 'Live Metrics', icon: '📊' },
      { id: 'analytics',    label: 'Analytics',    icon: '📈' },
    ]
  },
  {
    title: 'Settings',
    items: [
      { id: 'env',          label: 'Environment',  icon: '🔐' },
      { id: 'domains',      label: 'Domains',      icon: '🌐' },
      { id: 'security',     label: 'Security',     icon: '🛡️' },
      { id: 'team',         label: 'Team',         icon: '👥' },
      { id: 'settings',     label: 'Settings',     icon: '⚙️' },
    ]
  }
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
  const [bulkImporting, setBulkImporting] = useState(false);
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

  // Container controls
  const [containerAction, setContainerAction] = useState(null); // 'stopping'|'starting'|'restarting'|'cancelling'

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
  const [branches, setBranches] = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(false);

  // 🔐 Env Vault — AI missing variable scanner
  const [missingVars, setMissingVars] = useState(null); // null = not scanned, [] = none found
  const [missingVarsLoading, setMissingVarsLoading] = useState(false);
  const [addingMissingVar, setAddingMissingVar] = useState(null); // key being added

  const logsEndRef = useRef(null);
  const runtimeLogsEndRef = useRef(null);
  const socketRef  = useRef(null);
  const pollRef    = useRef(null);

  const fetchBranches = useCallback(async (repoFullName) => {
    if (!repoFullName) return;
    setLoadingBranches(true);
    try {
      const res = await api.post('/projects/repos/analyze', { repoFullName });
      if (res.data && res.data.branches) {
        setBranches(res.data.branches);
      }
    } catch (err) {
      console.warn('Failed to load repo branches:', err.message);
    } finally {
      setLoadingBranches(false);
    }
  }, []);

  const loadProject = useCallback(async () => {
    try {
      const r = await api.get(`/projects/${id}`);
      const p = r.data.project;
      setProject(p);
      fetchBranches(p.repoFullName);
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
  }, [id, navigate, fetchBranches]);

  const loadDeployments = useCallback(() =>
    api.get(`/deploy/${id}`).then(r => setDeployments(r.data.deployments || [])).catch(() => {}),
  [id]);

  const loadEnvVars = useCallback(() =>
    api.get(`/env/${id}`).then(r => setEnvVars(r.data.envVars || [])).catch(() => {}),
  [id]);

  const handleLoadPreviews = useCallback(async () => {
    setPreviewsLoading(true);
    try {
      const res = await api.get(`/previews/${id}`);
      setPreviews(res.data.previews || []);
    } catch (err) {
      console.error('Failed to load previews:', err);
    } finally {
      setPreviewsLoading(false);
    }
  }, [id]);

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

  useEffect(() => {
    loadProject();
    loadDeployments();
    loadEnvVars();
    return () => {
      socketRef.current?.disconnect();
      clearInterval(pollRef.current);
    };
  }, [loadProject, loadDeployments, loadEnvVars]);



  // Poller for previews in building state
  useEffect(() => {
    let interval;
    if (activeTab === 'previews' && previews.some(p => p.status === 'building')) {
      interval = setInterval(() => {
        handleLoadPreviews();
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [activeTab, previews, handleLoadPreviews]);

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

  const handleSyncStatus = async () => {
    try {
      const res = await api.post(`/projects/${id}/sync-status`);
      setProject(res.data.project);
      setError('');
      alert(`✅ ${res.data.message}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to sync project status');
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
    const lines = bulkEnv.split('\n').filter(l => l.includes('=') && !l.trim().startsWith('#'));
    if (lines.length === 0) { setError('No valid KEY=VALUE lines found.'); return; }
    setBulkImporting(true);
    setError('');
    try {
      const vars = lines.map(line => {
        const eqIdx = line.indexOf('=');
        return { key: line.slice(0, eqIdx).trim(), value: line.slice(eqIdx + 1).trim() };
      }).filter(v => v.key);
      const res = await api.post(`/env/${id}/bulk`, { vars });
      setSaveStatus(`✅ Imported ${res.data.created} new, updated ${res.data.updated} variables`);
      setTimeout(() => setSaveStatus(''), 4000);
      setBulkEnv(''); setShowBulk(false); loadEnvVars();
    } catch (err) {
      setError(err.response?.data?.message || 'Bulk import failed. Check your format.');
    } finally {
      setBulkImporting(false);
    }
  };

  // ── Container lifecycle controls ──────────────────────────────────────────────
  const handleContainerAction = async (action) => {
    setContainerAction(action + 'ing');
    setError('');
    try {
      await api.post(`/deploy/${id}/${action}`);
      setSaveStatus(`✅ Container ${action}ped successfully`);
      setTimeout(() => setSaveStatus(''), 3000);
      loadProject();
    } catch (err) {
      setError(err.response?.data?.message || `Failed to ${action} container`);
    } finally {
      setContainerAction(null);
    }
  };

  const handleCancelDeploy = async () => {
    if (!window.confirm('Cancel the current deployment?')) return;
    setContainerAction('cancelling');
    setError('');
    try {
      await api.post(`/deploy/${id}/cancel`);
      setSaveStatus('🛑 Deployment cancelled');
      setTimeout(() => setSaveStatus(''), 3000);
      loadDeployments();
      loadProject();
      clearInterval(pollRef.current);
      setDeploying(false);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to cancel deployment');
    } finally {
      setContainerAction(null);
    }
  };

  // ── Format milliseconds into "1m 23s" ─────────────────────────────────────────
  const formatDuration = (ms) => {
    if (!ms || ms < 0) return null;
    const totalSeconds = Math.floor(ms / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    if (mins === 0) return `${secs}s`;
    return `${mins}m ${secs}s`;
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

  const handleCreatePreview = async (e) => {
    e.preventDefault();
    if (!newPreviewPR || !newPreviewBranch) return;
    setCreatingPreview(true);
    try {
      await api.post(`/previews/${id}`, {
        prNumber: parseInt(newPreviewPR),
        prBranch: newPreviewBranch
      });
      setNewPreviewPR('');
      setNewPreviewBranch('');
      handleLoadPreviews();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to create preview');
    } finally {
      setCreatingPreview(false);
    }
  };

  const handleDestroyPreview = async (prNumber) => {
    if (!window.confirm(`Are you sure you want to destroy preview for PR #${prNumber}?`)) return;
    try {
      await api.delete(`/previews/${id}/${prNumber}`);
      handleLoadPreviews();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to destroy preview');
    }
  };

  const handleAiScanMissingVars = async () => {
    setMissingVarsLoading(true);
    setMissingVars(null);
    try {
      const res = await api.get(`/env/${id}/ai-scan`);
      setMissingVars(res.data.missingVars || []);
      if (res.data.missingVars?.length === 0) {
        alert('✨ All environment variables referenced in code are already configured in this vault!');
      }
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to scan environment variables');
    } finally {
      setMissingVarsLoading(false);
    }
  };

  const handleAddMissingVarDirect = async (key) => {
    const value = prompt(`Enter value for environment variable: ${key}`);
    if (value === null || value === '') return; // cancelled/empty
    setAddingMissingVar(key);
    try {
      await api.post(`/env/${id}`, { key, value });
      setMissingVars(prev => prev.filter(v => v !== key));
      loadEnvVars();
    } catch (err) {
      alert(err.response?.data?.message || 'Failed to add environment variable');
    } finally {
      setAddingMissingVar(null);
    }
  };

  // Auto-run background scans (readiness check, CVE vulnerabilities, missing env variables) as soon as project loads
  useEffect(() => {
    if (project) {
      if (!readiness && !readinessLoading) {
        handleReadinessCheck();
      }
      if (!vulnData && !vulnLoading) {
        handleVulnScan();
      }
      if (missingVars === null && !missingVarsLoading) {
        handleAiScanMissingVars();
      }
    }
  }, [project?._id, readiness, readinessLoading, vulnData, vulnLoading, missingVars, missingVarsLoading]);

  // Tab switch logic to auto-load tab details and disconnect sockets on tab cleanups
  useEffect(() => {
    if (activeTab === 'logs') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      if (logs.length === 0 && !deploying && deployments.length > 0) {
        viewLogs(deployments[0]);
      }
    } else if (activeTab === 'runtime-logs') {
      connectToRuntimeLogs();
    } else if (activeTab === 'previews') {
      handleLoadPreviews();
    } else if (activeTab === 'advisor') {
      if (!readiness && !readinessLoading) {
        handleReadinessCheck();
      }
    } else if (activeTab === 'security') {
      if (!vulnData && !vulnLoading) {
        handleVulnScan();
      }
    } else if (activeTab === 'env') {
      if (missingVars === null && !missingVarsLoading) {
        handleAiScanMissingVars();
      }
    } else {
      socketRef.current?.disconnect();
    }
  }, [activeTab, handleLoadPreviews, readiness, readinessLoading, vulnData, vulnLoading, missingVars, missingVarsLoading]);

  if (!project) return (
    <div className="launchpad-container flex-center" style={{ minHeight: '100vh' }}>
      <div className="loading-spinner" style={{ width: 40, height: 40 }} />
    </div>
  );

  const domain = import.meta.env.VITE_DOMAIN || 'launchlive.in';
  const getDeployUrl = () => {
    if (!project.subdomain) return null;
    if (project.customDomain && (project.customDomainStatus === 'active' || project.customDomainStatus === 'dns_verified')) {
      const isWildcard = project.customDomain.includes('nip.io') || project.customDomain.includes('sslip.io');
      const isSslActive = project.sslStatus === 'active';
      const scheme = (isSslActive && !isWildcard) ? 'https' : 'http';
      return `${scheme}://${project.customDomain}`;
    }
    return `https://${project.subdomain}.${domain}`;
  };
  const deployUrl = getDeployUrl();

  return (
    <div className="launchpad-container">
      {/* Header */}
      <header className="lp-header" style={{ display: 'block', padding: 0 }}>
        <div style={{ height: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 24px' }}>
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
            {/* Quick Repair: show Fix Status button when project shows failed but history has a success */}
            {!deploying && project.status === 'failed' && (
              <button
                onClick={handleSyncStatus}
                title="Repair project status from deployment history"
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: 'rgba(52,211,153,0.1)', color: '#34d399',
                  border: '1px solid rgba(52,211,153,0.25)',
                  cursor: 'pointer',
                }}
              >
                🔧 Fix Status
              </button>
            )}
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
            {branches.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)', fontWeight: 600 }}>SWITCH BRANCH:</span>
                <select
                  value={project?.branch || 'main'}
                  onChange={async (e) => {
                    const newBranch = e.target.value;
                    if (window.confirm(`Are you sure you want to switch branch to "${newBranch}" and deploy?`)) {
                      try {
                        setDeploying(true);
                        await api.patch(`/projects/${id}`, { branch: newBranch });
                        setProject(prev => ({ ...prev, branch: newBranch }));
                        setSettings(prev => ({ ...prev, branch: newBranch }));
                        handleDeploy();
                      } catch (err) {
                        alert(err.response?.data?.message || 'Failed to switch branch and deploy');
                      } finally {
                        setDeploying(false);
                      }
                    }
                  }}
                  className="lp-input"
                  style={{ width: 140, padding: '4px 10px', height: 32, fontSize: 13, background: 'var(--bg-surface)', border: '1px solid var(--border)', color: 'var(--text-main)', cursor: 'pointer', borderRadius: 6 }}
                  disabled={deploying}
                >
                  {branches.map(b => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </div>
            )}
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
        </div>
      </header>

      {/* Project Info Bar */}
      <div style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', padding: '12px 24px' }}>
        <div style={{ display: 'flex', gap: 32, flexWrap: 'wrap', fontSize: 13, color: 'var(--text-muted)' }}>
          <span>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ verticalAlign: 'middle', marginRight: 6 }}><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
            {project.repoFullName}
          </span>
          <span>Branch: <strong style={{ color: 'var(--text-main)' }}>{project.branch}</strong></span>
          <span>Framework: <strong style={{ color: 'var(--text-main)' }}>{project.framework || 'auto'}</strong></span>
          {deployUrl && <span>URL: <a href={deployUrl} target="_blank" rel="noreferrer" className="lp-info-bar-link">{deployUrl.replace(/^https?:\/\//, '')}</a></span>}
        </div>
      </div>

      <main className="lp-main" style={{ maxWidth: 'none', margin: 0, padding: 0, width: '100%' }}>
        <div className="lp-detail-layout">
          {/* Left Sidebar */}
          <div className="lp-sidebar-container">
            {SIDEBAR_GROUPS.map((group, idx) => (
              <div key={idx}>
                <div style={{
                  fontSize: '11px',
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  color: 'var(--text-dim)',
                  letterSpacing: '0.08em',
                  marginBottom: '8px',
                  paddingLeft: '12px'
                }}>
                  {group.title}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {group.items.map(item => (
                    <div
                      key={item.id}
                      className={`lp-sidebar-link ${activeTab === item.id ? 'active' : ''}`}
                      onClick={() => setActiveTab(item.id)}
                    >
                      <span style={{ width: 20, display: 'inline-flex', justifyContent: 'center', marginRight: 8, fontSize: '15px' }}>
                        {item.icon}
                      </span>
                      <span>{item.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Right Content Area */}
          <div className="lp-content-container">
            <div style={{ maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
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
          <div className="fade-in" style={{ display: 'grid', gap: 16 }}>
            {/* Container Quick Actions */}
            <div className="lp-card" style={{ padding: '16px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%',
                    background: project.status === 'live' ? '#10b981' : project.status === 'building' ? '#38bdf8' : '#64748b',
                    boxShadow: project.status === 'live' ? '0 0 8px rgba(16,185,129,0.6)' : project.status === 'building' ? '0 0 8px rgba(56,189,248,0.6)' : 'none',
                    animation: project.status === 'building' ? 'pulse 1.2s ease-in-out infinite' : 'none',
                  }} />
                  <span style={{ fontSize: 13, fontWeight: 600 }}>Container: <span style={{ color: project.status === 'live' ? '#10b981' : project.status === 'building' ? '#38bdf8' : 'var(--text-muted)', textTransform: 'capitalize' }}>{project.status || 'idle'}</span></span>
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {(project.status === 'building' || deploying) && (
                    <button
                      className="lp-btn-secondary"
                      style={{ padding: '6px 14px', fontSize: 12, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444' }}
                      onClick={handleCancelDeploy}
                      disabled={containerAction === 'cancelling'}
                    >
                      {containerAction === 'cancelling' ? '⏳ Cancelling...' : '🛑 Cancel Build'}
                    </button>
                  )}
                  {project.status === 'live' && (
                    <>
                      <button
                        className="lp-btn-secondary"
                        style={{ padding: '6px 14px', fontSize: 12 }}
                        onClick={() => handleContainerAction('restart')}
                        disabled={!!containerAction}
                      >
                        {containerAction === 'restarting' ? '⏳ Restarting...' : '🔄 Restart'}
                      </button>
                      <button
                        className="lp-btn-secondary"
                        style={{ padding: '6px 14px', fontSize: 12, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}
                        onClick={() => handleContainerAction('stop')}
                        disabled={!!containerAction}
                      >
                        {containerAction === 'stopping' ? '⏳ Stopping...' : '⏹ Stop'}
                      </button>
                    </>
                  )}
                  {(project.status === 'stopped' || project.status === 'failed') && project.containerId && (
                    <button
                      className="lp-btn-primary"
                      style={{ padding: '6px 14px', fontSize: 12 }}
                      onClick={() => handleContainerAction('start')}
                      disabled={!!containerAction}
                    >
                      {containerAction === 'starting' ? '⏳ Starting...' : '▶ Start Container'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="lp-card" style={{ padding: 0 }}>
              <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ fontSize: 16 }}>Deployment Timeline</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 2 }}>Production is always the top entry. Click Rollback to revert to a past version.</p>
                </div>
                <button className="lp-btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={() => { handleLoadTrends(); setActiveTab('analytics'); }}>
                  📈 Build Trends
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
                    const isActive = dep.status === 'queued' || dep.status === 'building';
                    const dur = formatDuration(dep.duration);
                    return (
                      <div key={dep._id} style={{
                        display: 'flex', alignItems: 'stretch', gap: 0,
                        padding: '0 24px',
                        borderBottom: i < deployments.length - 1 ? '1px solid var(--border)' : 'none',
                        background: isProduction ? 'rgba(52,211,153,0.03)' : isActive ? 'rgba(56,189,248,0.02)' : 'transparent',
                        transition: 'background 0.2s',
                      }}>
                        {/* Timeline dot + line */}
                        <div style={{ width: 40, flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative' }}>
                          <div style={{
                            width: 12, height: 12, borderRadius: '50%', flexShrink: 0,
                            background: dep.status === 'success' ? '#34d399' : dep.status === 'failed' ? '#f87171' : dep.status === 'building' ? '#38bdf8' : '#64748b',
                            boxShadow: dep.status === 'success' ? '0 0 8px rgba(52,211,153,0.5)' : dep.status === 'failed' ? '0 0 8px rgba(248,113,113,0.4)' : dep.status === 'building' ? '0 0 8px rgba(56,189,248,0.5)' : 'none',
                            animation: dep.status === 'building' ? 'pulse 1.2s ease-in-out infinite' : 'none',
                            marginTop: 20,
                            zIndex: 2,
                          }} />
                          {deployments.length > 1 && (
                            <div style={{
                              position: 'absolute',
                              width: 2,
                              left: 19,
                              background: 'var(--border)',
                              zIndex: 1,
                              top: i === 0 ? 26 : 0,
                              bottom: i === deployments.length - 1 ? 'calc(100% - 26px)' : 0,
                            }} />
                          )}
                        </div>

                        {/* Deployment info */}
                        <div style={{ flex: 1, padding: '16px 0 16px 12px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
                            <span style={{ fontWeight: 600, fontSize: 14 }}>{dep.commitMessage || 'Manual Deploy'}</span>
                            <span className={`lp-badge ${dep.status}`} style={{ fontSize: 11 }}>{dep.status}</span>
                            {isProduction && <span className="lp-badge live" style={{ fontSize: 10 }}>⚡ Production</span>}
                            {dep.isAutoHeal && <span className="lp-badge" style={{ fontSize: 10, background: 'rgba(56,189,248,0.1)', color: 'var(--accent-primary)', border: '1px solid rgba(56,189,248,0.2)' }} title={dep.autoHealFixDescription}>🤖 AI Healed</span>}
                            {dep.rollbackFrom && <span className="lp-badge" style={{ fontSize: 10, background: 'rgba(251,191,36,0.1)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.2)' }}>🔄 Rollback</span>}
                          </div>
                          <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-dim)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap', alignItems: 'center' }}>
                            {dep.commitSha && <span style={{ background: 'rgba(255,255,255,0.05)', padding: '1px 6px', borderRadius: 4 }}>{dep.commitSha.slice(0, 7)}</span>}
                            {dep.branch && <span>↳ {dep.branch}</span>}
                            {dur && <span style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3 }}>⏱ {dur}</span>}
                            <span>{new Date(dep.createdAt).toLocaleString()}</span>
                            {dep.triggeredBy?.username && <span style={{ color: 'var(--text-muted)' }}>by @{dep.triggeredBy.username}</span>}
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0, alignItems: 'center', padding: '16px 0' }}>
                          <button className="lp-btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }} onClick={() => viewLogs(dep)}>Logs</button>
                          {!isProduction && dep.status === 'success' && (
                            <button
                              className="lp-btn-secondary"
                              style={{ padding: '5px 12px', fontSize: 12, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24' }}
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
                borderLeft: '4px solid var(--accent-primary)',
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
                              border: '2px solid var(--bg-main)',
                              boxShadow: `0 0 8px ${color}`
                            }} />
                            
                            <div style={{ flex: 1 }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-main)' }}>{step.step}</span>
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
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13, background: 'linear-gradient(135deg, rgba(168,85,247,0.1) 0%, rgba(129,140,248,0.1) 100%)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc' }} onClick={handleAiScanMissingVars} disabled={missingVarsLoading}>
                    {missingVarsLoading ? 'Scanning...' : '🔮 Scan Missing Keys'}
                  </button>
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13, background: 'linear-gradient(135deg, rgba(56,189,248,0.1) 0%, rgba(59,130,246,0.1) 100%)', border: '1px solid rgba(56,189,248,0.3)', color: '#38bdf8' }} onClick={handleAiAutoDetect} disabled={aiScanning}>
                    {aiScanning ? 'Scanning...' : '🔍 AI Auto-Detect'}
                  </button>
                  <button className="lp-btn-secondary" style={{ padding: '7px 14px', fontSize: 13 }} onClick={() => setShowBulk(!showBulk)}>
                    {showBulk ? 'Manual' : '📋 Bulk Import'}
                  </button>
                </div>
              </div>

              {/* Suggestion Chips */}
              {missingVars && missingVars.length > 0 && (
                <div className="glass fade-in" style={{ padding: '16px 20px', borderRadius: 12, border: '1px solid rgba(192, 132, 252, 0.25)', background: 'rgba(168, 85, 247, 0.02)', marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#c084fc', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <span>💡</span> Referenced Keys Missing from Vault (Click to add):
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {missingVars.map(v => (
                      <button
                        key={v}
                        onClick={() => handleAddMissingVarDirect(v)}
                        disabled={addingMissingVar === v}
                        style={{
                          background: 'rgba(168, 85, 247, 0.1)',
                          border: '1px solid rgba(168, 85, 247, 0.25)',
                          color: '#c084fc',
                          padding: '6px 12px',
                          borderRadius: 20,
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          borderStyle: 'solid'
                        }}
                      >
                        {addingMissingVar === v ? 'Adding...' : `+ ${v}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}

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
                    <button className="lp-btn-primary" onClick={handleBulkImport} disabled={bulkImporting}>
                      {bulkImporting ? 'Importing...' : 'Import All'}
                    </button>
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
                    {key === 'branch' && branches.length > 0 ? (
                      <select
                        value={settings.branch}
                        onChange={e => setSettings(s => ({ ...s, branch: e.target.value }))}
                        className="lp-input"
                        style={{ background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
                      >
                        {branches.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        value={settings[key]}
                        onChange={e => setSettings(s => ({ ...s, [key]: e.target.value }))}
                        placeholder={placeholder}
                        className={`lp-input${mono ? ' lp-input-mono' : ''}`}
                      />
                    )}
                  </div>
                ))}

                <div className="flex-between" style={{ paddingTop: 8 }}>
                  {saveStatus === 'saved' && <div className="lp-status-bar success" style={{ padding: '6px 14px', fontSize: 12 }}>✓ Settings saved</div>}
                  {saveStatus === 'error' && <div className="lp-status-bar error" style={{ padding: '6px 14px', fontSize: 12 }}>Failed to save</div>}
                  {saveStatus && saveStatus !== 'saved' && saveStatus !== 'error' && saveStatus !== 'saving' && (
                    <div className="lp-status-bar success" style={{ padding: '6px 14px', fontSize: 12 }}>{saveStatus}</div>
                  )}
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
              borderLeft: '4px solid var(--accent-primary)',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                🤖 AI Auto-Healing & Self-Correction
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 24 }}>
                When enabled, LaunchLive AI automatically intercepts deployment/health check failures, analyzes the logs, patches your code files locally, and re-runs the build.
              </p>

              <div style={{ display: 'grid', gap: 20 }}>
                <div className="flex-between">
                  <div className="lp-section-label" style={{ margin: 0 }}>ENABLE AI AUTO-HEALING</div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    <input 
                      type="checkbox" 
                      checked={settings.autoHeal} 
                      onChange={e => setSettings(s => ({ ...s, autoHeal: e.target.checked }))}
                      style={{ width: 40, height: 20, accentColor: 'var(--accent-primary)', cursor: 'pointer' }}
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
                      style={{ background: 'var(--bg-surface)', color: 'var(--text-main)', border: '1px solid var(--border)' }}
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

            {/* GitHub Webhook Setup Card */}
            <div className="lp-card glass" style={{
              padding: 28,
              borderLeft: '4px solid #f59e0b',
              background: 'linear-gradient(135deg, rgba(245,158,11,0.05) 0%, rgba(251,191,36,0.02) 100%)'
            }}>
              <h3 style={{ fontSize: 16, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
                🔔 GitHub Auto-Deploy Webhook
              </h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
                Add this webhook to your GitHub repository to trigger automatic deployments on every push to <code style={{ color: 'var(--accent-primary)' }}>{settings.branch || 'main'}</code>.
              </p>
              <div style={{ display: 'grid', gap: 14 }}>
                {/* Webhook URL */}
                <div>
                  <div className="lp-section-label" style={{ marginBottom: 6 }}>WEBHOOK URL</div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input
                      readOnly
                      value={`${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/webhook`}
                      className="lp-input lp-input-mono"
                      style={{ flex: 1, fontSize: 12, cursor: 'text' }}
                      onFocus={e => e.target.select()}
                    />
                    <button
                      className="lp-btn-secondary"
                      style={{ flexShrink: 0, padding: '8px 16px', fontSize: 12 }}
                      onClick={() => {
                        const url = `${import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:5000'}/api/deploy/webhook`;
                        navigator.clipboard.writeText(url);
                        alert('Webhook URL copied to clipboard!');
                      }}
                    >
                      📋 Copy
                    </button>
                  </div>
                </div>
                {/* Instructions */}
                <div style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)', fontSize: 13, color: 'var(--text-muted)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--text-main)', marginBottom: 6 }}>Setup steps in GitHub:</div>
                  <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, lineHeight: 1.6 }}>
                    <li>Go to your repo → <strong>Settings</strong> → <strong>Webhooks</strong> → <strong>Add webhook</strong></li>
                    <li>Paste the URL above as <strong>Payload URL</strong></li>
                    <li>Set <strong>Content type</strong> to <code style={{ color: 'var(--accent-primary)' }}>application/json</code></li>
                    <li>Select <strong>Just the push event</strong></li>
                    <li>Click <strong>Add webhook</strong> — deployments will trigger automatically!</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Automation Guide ── */}
        {activeTab === 'guide' && (
          <div className="fade-in" style={{ display: 'grid', gap: 20, maxWidth: 900 }}>
            <div className="lp-card glass" style={{
              padding: 32,
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.03) 100%)',
              borderLeft: '4px solid var(--accent-primary)',
            }}>
              <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em', margin: 0 }}>How LaunchLive Automates Your DevOps & SRE</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, maxWidth: 680, margin: '8px 0 0 0' }}>
                LaunchLive runs SRE monitoring, zero-downtime server scaling, and automated code healing in the background. Here is a breakdown of the core systems and how they handle automation.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
              {[
                {
                  title: '🤖 AI Auto-Healing & Self-Correction',
                  desc: 'If your application crashes or fails during build, the LaunchLive health monitor triggers the AI agent. The AI inspects the build/runtime logs, writes a code fix patch, verifies it locally inside a test container, and applies it directly. Based on your settings, it can also automatically open a GitHub Pull Request.',
                  trigger: 'Triggered by: Docker container exit / Webhook build failures'
                },
                {
                  title: '🔍 Ephemeral PR Preview Environments',
                  desc: 'When you open a Pull Request on GitHub, LaunchLive receives a webhook event. It automatically clones the PR branch, isolates its database variables, builds a preview Docker container, and comments the unique live URL directly on your GitHub PR. When the PR is merged or closed, it automatically destroys the container to save resources.',
                  trigger: 'Triggered by: GitHub webhook pull_request events'
                },
                {
                  title: '⚡ Zero-Downtime Container Scaling',
                  desc: 'When you resize resource limits (CPU/RAM bounds), LaunchLive performs an SRE hot-swap. It boots a new container running the active image with the new resource constraints, verifies the internal port is ready, updates the Nginx reverse proxy routing, and finally shuts down the old container. Your app stays 100% online.',
                  trigger: 'Triggered by: Saving resource limits in settings'
                },
                {
                  title: '🛡️ Dependency & Security Scanning',
                  desc: 'LaunchLive automatically audits your package-lock.json/yarn.lock files on every deployment. If it detects vulnerabilities (CVEs), it assesses the threat level. The SRE agent then generates verified upgrade patches using AI, letting you secure your codebase with a single click.',
                  trigger: 'Triggered by: Code checkouts / Deployment builds'
                },
                {
                  title: '🌐 Zero-Downtime SSL & DNS Routing',
                  desc: 'When you create a project, LaunchLive registers the DNS record on Cloudflare and uses Certbot to provision Let\'s Encrypt SSL. A background cron job runs every Monday at 3:00 AM to automatically renew certificates, ensuring your applications never lose HTTPS.',
                  trigger: 'Triggered by: Project creation / Weekly cron schedule'
                },
                {
                  title: '📈 Observability & Live Analytics',
                  desc: 'A Redis-backed sliding window tracks response times, error rates, and route access logs in real-time. This telemetry data is piped directly into your dashboard, enabling the health worker to detect anomalies and trigger restarts before users experience downtime.',
                  trigger: 'Triggered by: Node.js proxy middleware interceptor'
                }
              ].map((g, i) => (
                <div key={i} className="lp-card" style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <h4 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>{g.title}</h4>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6, flex: 1, margin: 0 }}>{g.desc}</p>
                  <div style={{
                    fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)',
                    background: 'rgba(56, 189, 248, 0.08)', padding: '6px 12px', borderRadius: 8,
                    border: '1px solid rgba(56, 189, 248, 0.15)', marginTop: 8
                  }}>
                    {g.trigger}
                  </div>
                </div>
              ))}
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
                      <div key={s.label} style={{ padding: '16px 20px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
                        <div className="lp-section-label">{s.label}</div>
                        <div style={{ fontSize: 24, fontWeight: 800, color: s.color, marginTop: 4 }}>{s.value}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
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
                      <div key={s.label} style={{ padding: '16px 20px', background: 'var(--bg-surface)', borderRadius: 12, border: '1px solid var(--border)' }}>
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
            <div className="lp-card glass" style={{ padding: 20, borderLeft: '4px solid #f87171', background: 'linear-gradient(135deg, rgba(248, 113, 113, 0.04) 0%, rgba(251, 191, 36, 0.01) 100%)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, margin: 0 }}>🛡️ Automated Vulnerability Scanner & CVE Patching</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                <strong>How it works:</strong> LaunchLive automatically scans your dependencies for known vulnerabilities (CVEs) on every build. When security threats are found, you can generate verified AI patches that upgrade packages or resolve issues with one click.
              </p>
            </div>
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
                        <div key={pkg.name} style={{ background: 'var(--bg-surface)', borderRadius: 12, padding: '16px 20px', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 14 }}>{pkg.name}</span>
                              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text-dim)' }}>v{pkg.version}</span>
                            </div>
                            <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{pkg.vulns.length} issue{pkg.vulns.length !== 1 ? 's' : ''}</span>
                          </div>
                          {pkg.vulns.map(v => (
                            <div key={v.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', marginBottom: 8, padding: '10px 12px', background: 'var(--bg-main)', borderRadius: 8, border: `1px solid ${{ critical: 'rgba(248,113,113,0.3)', high: 'rgba(251,146,60,0.3)', medium: 'rgba(251,191,36,0.3)', low: 'rgba(52,211,153,0.2)' }[v.severity] || 'var(--border)'}` }}>
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

        {/* ── PR Previews ── */}
        {activeTab === 'previews' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="lp-card glass" style={{ padding: 20, borderLeft: '4px solid var(--accent-primary)', background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.04) 0%, rgba(129, 140, 248, 0.01) 100%)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, margin: 0 }}>🔍 Ephemeral Pull Request (PR) Preview Environments</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                <strong>How it works:</strong> LaunchLive listens to your GitHub repository webhooks. When you open a Pull Request (PR), it automatically builds an isolated preview container of that branch and comments the live URL directly on your PR. When you merge or close the PR, the container is automatically deleted to save resources.
              </p>
            </div>
            <div className="lp-card glass" style={{ padding: 28 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 24 }}>
                <div>
                  <h3 style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                    🔍 PR Preview Environments
                  </h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                    Deploy isolated sandboxed versions of your application for active GitHub Pull Requests.
                  </p>
                </div>
              </div>

              {/* Form to manual deploy PR */}
              <form onSubmit={handleCreatePreview} style={{ display: 'flex', flexWrap: 'wrap', gap: 12, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.05)', padding: 18, borderRadius: 12, marginBottom: 24 }}>
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>PR Number</div>
                  <input
                    type="number"
                    value={newPreviewPR}
                    onChange={e => setNewPreviewPR(e.target.value)}
                    placeholder="e.g. 12"
                    className="lp-input"
                    style={{ background: 'rgba(0,0,0,0.2)' }}
                    required
                  />
                </div>
                <div style={{ flex: 2, minWidth: 200 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6, fontWeight: 700 }}>PR Branch Name</div>
                  <input
                    type="text"
                    value={newPreviewBranch}
                    onChange={e => setNewPreviewBranch(e.target.value)}
                    placeholder="e.g. feature/login-page"
                    className="lp-input"
                    style={{ background: 'rgba(0,0,0,0.2)' }}
                    required
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="submit"
                    disabled={creatingPreview || !project.subdomain}
                    className="lp-btn-primary"
                    style={{ height: 42, padding: '0 24px', fontSize: 13, borderRadius: 8, background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)', fontWeight: 600 }}
                  >
                    {creatingPreview ? 'Building Preview...' : '🚀 Spin Up Preview'}
                  </button>
                </div>
              </form>

              {/* Previews List */}
              {previewsLoading && previews.length === 0 ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '32px 0', color: 'var(--text-muted)' }}>
                  <div className="loading-spinner" style={{ width: 16, height: 16 }} />
                  Loading active preview environments...
                </div>
              ) : previews.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '48px 0', border: '1px dashed rgba(255,255,255,0.08)', borderRadius: 12, background: 'rgba(0,0,0,0.05)' }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
                  <h4 style={{ margin: '0 0 6px 0', color: 'var(--text-main)', fontSize: 14 }}>No Active PR Previews</h4>
                  <p style={{ margin: 0, color: 'var(--text-dim)', fontSize: 13 }}>Specify a PR number and branch above to spawn a dedicated test container.</p>
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 20 }}>
                  {previews.map(p => (
                    <div key={p.prNumber} className="lp-card glass" style={{ padding: 20, border: '1px solid rgba(255,255,255,0.06)', background: 'rgba(255,255,255,0.01)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 14 }}>
                      <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                          <span style={{ fontWeight: 800, fontSize: 15, color: 'var(--text-main)' }}>PR #{p.prNumber}</span>
                          
                          {/* Badge */}
                          {p.status === 'live' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(16,185,129,0.1)', color: '#10b981', border: '1px solid rgba(16,185,129,0.2)' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981', display: 'inline-block', boxShadow: '0 0 6px #10b981' }}></span> Live
                            </span>
                          )}
                          {p.status === 'building' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(245,158,11,0.1)', color: '#f59e0b', border: '1px solid rgba(245,158,11,0.2)' }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b', display: 'inline-block', animation: 'pulse-dot 1s infinite' }}></span> Building
                            </span>
                          )}
                          {p.status === 'failed' && (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
                              ⚠️ Failed
                            </span>
                          )}
                        </div>

                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                          Branch: <code style={{ color: 'var(--accent-primary)', fontSize: 12 }}>{p.branch}</code>
                        </div>

                        {p.previewUrl && p.status === 'live' && (
                          <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 8 }}>
                            URL: <a href={p.previewUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontWeight: 600 }}>{p.previewUrl}</a>
                          </div>
                        )}

                        {p.error && p.status === 'failed' && (
                          <div style={{ fontSize: 11, background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.15)', borderRadius: 8, padding: 10, color: '#ef4444', fontFamily: 'var(--font-mono)', maxHeight: 100, overflowY: 'auto', wordBreak: 'break-all' }}>
                            Error: {p.error}
                          </div>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: 10, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12 }}>
                        {p.status === 'live' && p.previewUrl && (
                          <a href={p.previewUrl} target="_blank" rel="noreferrer" className="lp-btn-primary" style={{ flex: 1, textAlign: 'center', textDecoration: 'none', padding: '8px 0', fontSize: 12, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            Open Preview ↗
                          </a>
                        )}
                        <button onClick={() => handleDestroyPreview(p.prNumber)} className="lp-btn-secondary" style={{ flex: 1, color: 'var(--accent-danger)', border: '1px solid rgba(239,68,68,0.15)', padding: '8px 0', fontSize: 12, borderRadius: 6, height: 'auto' }}>
                          Destroy Preview
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── AI Deployment Advisor ── */}
        {activeTab === 'advisor' && (
          <div className="fade-in" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div className="lp-card glass" style={{ padding: 20, borderLeft: '4px solid #818cf8', background: 'linear-gradient(135deg, rgba(129, 140, 248, 0.04) 0%, rgba(56, 189, 248, 0.01) 100%)' }}>
              <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 4, margin: 0 }}>🧠 AI Code Readiness & SRE Advisor</h4>
              <p style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.5, margin: 0 }}>
                <strong>How it works:</strong> LaunchLive AI scans your repository structure, configuration files, and package dependencies. It calculates a readiness score and uncovers missing environment variables or setup errors before you trigger a deployment to avoid build failures.
              </p>
            </div>
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
                  <div style={{ display: 'flex', gap: 32, alignItems: 'center', marginBottom: 28, padding: '24px 28px', background: 'var(--bg-surface)', borderRadius: 16, border: '1px solid var(--border)' }}>
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
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}