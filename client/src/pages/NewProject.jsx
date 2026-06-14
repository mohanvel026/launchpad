import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import NotificationCenter from '../components/NotificationCenter';
import CommandPalette from '../components/CommandPalette';

const STACK_META = {
  react:           { icon: '⚛️',  label: 'React / Vite',       color: '#61dafb' },
  vue:             { icon: '💚',  label: 'Vue.js',              color: '#42b883' },
  svelte:          { icon: '🔥',  label: 'Svelte',              color: '#ff3e00' },
  astro:           { icon: '🚀',  label: 'Astro',               color: '#ff5d01' },
  angular:         { icon: '🔴',  label: 'Angular',             color: '#dd0031' },
  next:            { icon: '▲',   label: 'Next.js',             color: '#ffffff' },
  nuxt:            { icon: '💚',  label: 'Nuxt.js',             color: '#00dc82' },
  node:            { icon: '🟢',  label: 'Node.js API',         color: '#68a063' },
  mern:            { icon: '📦',  label: 'MERN Stack',          color: '#47a248' },
  'fullstack-split':{ icon:'🏗️',  label: 'Fullstack Split',     color: '#a78bfa' },
  static:          { icon: '📄',  label: 'Static Site',         color: '#94a3b8' },
  unknown:         { icon: '🔍',  label: 'Auto Detect',         color: '#64748b' },
};

// ── Phase display state machine ────────────────────────────────────────────────
const PHASES = [
  { id: 'pick',     label: 'Pick Repository' },
  { id: 'analyze',  label: 'AI Analyzing…'   },
  { id: 'review',   label: 'Review & Deploy'  },
  { id: 'deploying',label: 'Deploying'        },
];

const SENSITIVE_KEYS = [
  'STRIPE_SECRET_KEY', 'STRIPE_PUBLISHABLE_KEY', 'STRIPE_WEBHOOK_SECRET',
  'STRIPE_KEY', 'STRIPE_API_KEY',
  'SENDGRID_API_KEY', 'SENDGRID_KEY', 'MAILGUN_API_KEY', 'SMTP_USER', 'SMTP_PASS',
  'EMAIL_USER', 'EMAIL_PASS', 'MAIL_USER', 'MAIL_PASS',
  'CLOUDINARY_URL', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
  'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET',
  'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET',
  'FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET',
  'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET',
  'TWITTER_API_KEY', 'TWITTER_API_SECRET',
  'FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID',
  'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN',
  'RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET',
  'PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET',
  'ANTHROPIC_API_KEY', 'OPENAI_API_KEY',
];

const AUTO_GENERATED_KEYS = [
  'JWT_SECRET', 'JWT_SECRET_KEY', 'SESSION_SECRET', 'COOKIE_SECRET',
  'SECRET_KEY', 'APP_SECRET', 'ENCRYPTION_KEY', 'TOKEN_SECRET',
  'REFRESH_SECRET', 'AUTH_SECRET', 'CSRF_SECRET',
];

const AUTO_DEFAULTS = {
  PORT: '3000', NODE_ENV: 'production', ENVIRONMENT: 'production',
  CORS_ORIGIN: '*', BCRYPT_ROUNDS: '10', SALT_ROUNDS: '10',
  JWT_EXPIRES_IN: '7d', LOG_LEVEL: 'info', DEBUG: 'false',
};

const isSensitive = (key) => {
  if (!key) return false;
  const u = key.toUpperCase();
  const isDbOrGemini = ['DATABASE_URL', 'DATABASE_URI', 'MONGODB_URI', 'MONGO_URI', 'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT', 'GEMINI_API_KEY', 'GROQ_API_KEY'].includes(u);
  if (isDbOrGemini) return false;
  return SENSITIVE_KEYS.some(k => u.includes(k) || k.includes(u));
};

const isAutoGen = (key) => {
  if (!key) return false;
  const u = key.toUpperCase();
  return AUTO_GENERATED_KEYS.some(k => u === k || u.endsWith('_SECRET') || u.endsWith('_KEY'));
};

const hasDefault = (key) => {
  if (!key) return false;
  return AUTO_DEFAULTS[key.toUpperCase()] !== undefined;
};

const isAutoConfigured = (key) => {
  if (!key) return false;
  const u = key.toUpperCase();
  const isDb = ['DATABASE_URL', 'DATABASE_URI', 'MONGODB_URI', 'MONGO_URI', 'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT'].includes(u);
  const isAi = ['GEMINI_API_KEY', 'GROQ_API_KEY'].includes(u);
  return isDb || isAi || isAutoGen(key) || hasDefault(key);
};

const isOptional = (key) => {
  if (!key) return false;
  const u = key.toUpperCase();
  const optionalKeywords = [
    'SENDGRID', 'MAILGUN', 'SMTP', 'EMAIL', 'MAIL', 'CLOUDINARY',
    'AWS', 'S3', 'TELEGRAM', 'SLACK', 'DISCORD', 'TWILIO', 'ANALYTICS', 'GA_'
  ];
  return optionalKeywords.some(kw => u.includes(kw));
};

const requiresUserInput = (key) => {
  if (!key) return false;
  return !isAutoConfigured(key) && isSensitive(key) && !isOptional(key);
};

export default function NewProject() {
  const navigate = useNavigate();
  const domain = import.meta.env.VITE_DOMAIN || 'launchlive.in';
  const { user } = useAuth();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setIsPaletteOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Repo list
  const [repos,        setRepos]        = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [search,       setSearch]       = useState('');
  const [selected,     setSelected]     = useState(null);

  // Analysis
  const [phase,     setPhase]     = useState('pick');
  const [analysis,  setAnalysis]  = useState(null); // { stack, branches, defaultBranch, envExampleVars, ... }
  const [analyzeErr,setAnalyzeErr]= useState('');

  // Editable (override) fields
  const [branch,    setBranch]    = useState('main');
  const [envVars,   setEnvVars]   = useState([]);   // [{key, value, fromExample}]
  const [revealed,  setRevealed]  = useState({});
  const [scanStep,  setScanStep]  = useState(0);
  const [scanDetails, setScanDetails] = useState({
    stack: 'Scanning repository file tree...',
    branch: 'Waiting for repository connection...',
    env: 'Waiting for environment manifest...'
  });

  // Custom project name & subdomain live validation
  const [projectName, setProjectName] = useState('');
  const [subdomainAvailable, setSubdomainAvailable] = useState(null);
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);

  useEffect(() => {
    if (!projectName.trim()) {
      setTimeout(() => {
        setSubdomainAvailable(null);
      }, 0);
      return;
    }

    const delayDebounceFn = setTimeout(async () => {
      setCheckingSubdomain(true);
      try {
        const slug = projectName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
        const res = await api.get(`/projects/check-subdomain?subdomain=${slug}`);
        setSubdomainAvailable(res.data.available);
      } catch {
        setSubdomainAvailable(null);
      } finally {
        setCheckingSubdomain(false);
      }
    }, 400); // 400ms debounce

    return () => clearTimeout(delayDebounceFn);
  }, [projectName]);

  // Deploy
  const [deploying, setDeploying] = useState(false);
  const [error,     setError]     = useState('');

  // ── Load repos ─────────────────────────────────────────────────────────────
  useEffect(() => {
    api.get('/projects/repos')
      .then(r => setRepos(r.data.repos || []))
      .catch(e => setError(e.response?.data?.message || 'Failed to load repositories'))
      .finally(() => setLoadingRepos(false));
  }, []);

  const filtered = repos.filter(r =>
    r.fullName?.toLowerCase().includes(search.toLowerCase())
  );

  // ── Pick repo → trigger analysis with sequential animation ──
  const handleSelectRepo = useCallback(async (repo) => {
    setSelected(repo);
    setProjectName(repo.name || '');
    setPhase('analyze');
    setAnalyzeErr('');
    setAnalysis(null);
    setScanStep(0);
    setScanDetails({
      stack: 'Scanning repository file tree...',
      branch: 'Waiting for repository connection...',
      env: 'Waiting for environment manifest...'
    });

    let apiData = null;
    let apiError = null;

    // Trigger API call in parallel
    api.post('/projects/repos/analyze', { repoFullName: repo.fullName })
      .then(res => {
        apiData = res.data;
        return res.data;
      })
      .catch(err => {
        apiError = err.response?.data?.message || 'Could not analyze repo. You can still deploy manually.';
        return null;
      });

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    
    (async () => {
      // 1. Stack detection scanning...
      await sleep(700);
      let data = apiData;
      if (!data) {
        // Wait if API is slow
        while (!apiData && !apiError) {
          await sleep(100);
        }
        data = apiData;
      }
      
      if (apiError) {
        setScanDetails(prev => ({ ...prev, stack: '⚠️ Analysis failed' }));
        setAnalyzeErr(apiError);
        setAnalysis({ stack: 'unknown', branches: [repo.defaultBranch || 'main'], defaultBranch: repo.defaultBranch || 'main', envExampleVars: [] });
        setBranch(repo.defaultBranch || 'main');
        setEnvVars([]);
        setPhase('review');
        return;
      }

      // Stack detected!
      const stackName = STACK_META[data.stack]?.label || data.stack || 'Custom';
      setScanDetails(prev => ({
        ...prev,
        stack: `✨ Detected ${stackName} stack!`,
        branch: 'Listing branches on remote...'
      }));
      setScanStep(1);

      // 2. Branch listing...
      await sleep(700);
      const branchCount = data.branches?.length || 1;
      setScanDetails(prev => ({
        ...prev,
        branch: `📋 Found ${branchCount} branches (Default: ${data.defaultBranch || 'main'})`,
        env: 'Analyzing .env.example configuration...'
      }));
      setScanStep(2);

      // 3. Env discovery...
      await sleep(700);
      const envCount = data.envExampleVars?.length || 0;
      setScanDetails(prev => ({
        ...prev,
        env: envCount > 0 ? `🔑 Found ${envCount} env variables in .env.example` : '✅ No env variables required'
      }));
      setScanStep(3);

      // Set state variables for review phase
      setAnalysis(data);
      setBranch(data.defaultBranch || 'main');
      if (data.envExampleVars?.length > 0) {
        setEnvVars(data.envExampleVars.map(v => {
          const lowerVal = (v.placeholder || '').toLowerCase();
          const isPlaceholder = lowerVal.includes('placeholder') || lowerVal.includes('your_') || lowerVal.includes('<your') || lowerVal.includes('insert_here') || lowerVal.includes('localhost') || lowerVal.includes('127.0.0.1') || lowerVal.trim() === '';
          
          return {
            key: v.key,
            value: isPlaceholder ? '' : v.placeholder,
            placeholder: v.placeholder || '',
            fromExample: true
          };
        }));
      } else {
        setEnvVars([]);
      }

      // Brief pause for success state celebration, then go to review
      await sleep(600);
      setPhase('review');
    })();
  }, []);

  // ── Env helpers ────────────────────────────────────────────────────────────
  const updateEnv   = (i, field, val) => setEnvVars(v => v.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  const addEnvRow   = () => setEnvVars(v => [...v, { key: '', value: '', fromExample: false }]);
  const removeEnvRow= (i) => setEnvVars(v => v.filter((_, idx) => idx !== i));

  const missingCount = envVars.filter(e => {
    if (requiresUserInput(e.key)) {
      const val = e.value || '';
      const isPlaceholder = val.includes('placeholder') || val.includes('your_') || val.includes('${') || val.includes('{{') || val.trim() === '';
      return isPlaceholder;
    }
    return false;
  }).length;

  // ── Deploy ─────────────────────────────────────────────────────────────────
  const handleDeploy = async () => {
    if (!selected) return;
    if (subdomainAvailable === false) {
      setError('The subdomain already exists. Please choose a different project name.');
      return;
    }
    setDeploying(true); setError('');
    try {
      const res = await api.post('/projects', {
        repoFullName: selected.fullName,
        branch,
        name:         projectName.trim(),
        framework:    (analysis?.stack && analysis.stack !== 'unknown') ? analysis.stack : undefined,
      });
      const projectId = res.data.project._id;

      // Save env vars
      const valid = envVars.filter(e => e.key.trim() && e.value.trim());
      await Promise.all(valid.map(e =>
        api.post(`/env/${projectId}`, { key: e.key.trim(), value: e.value.trim() })
      ));

      // Trigger deployment
      await api.post(`/deploy/${projectId}`);
      navigate(`/projects/${projectId}`);
    } catch (e) {
      setError(e.response?.data?.message || 'Deployment failed. Please try again.');
      setDeploying(false);
    }
  };

  const stackMeta = STACK_META[analysis?.stack] || STACK_META.unknown;

  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="launchlive-container" style={{ minHeight: '100vh' }}>
      {/* Header */}
      <header className="lp-header">
        <div className="lp-page lp-header-inner" style={{ maxWidth: 820 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <button className="lp-btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => navigate('/dashboard')}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
              Back
            </button>
            <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
            <span style={{ fontWeight: 700, fontSize: 15 }}>New Project</span>
          </div>

          {/* Phase progress */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {PHASES.filter(p => p.id !== 'deploying').map((p, i) => {
              const phaseOrder = ['pick','analyze','review'];
              const currentIdx = phaseOrder.indexOf(phase);
              const thisIdx = phaseOrder.indexOf(p.id);
              const done   = currentIdx > thisIdx;
              const active = currentIdx === thisIdx;
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: '50%', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 700,
                    background: done ? '#22c55e' : active ? 'linear-gradient(135deg,#38bdf8,#818cf8)' : 'var(--border)',
                    color: (done || active) ? 'white' : 'var(--text-dim)', transition: 'all 0.3s',
                  }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: active ? 700 : 400, color: active ? 'var(--text-main)' : 'var(--text-dim)' }}>{p.label}</span>
                  {i < 2 && <div style={{ width: 20, height: 1, background: 'var(--border)' }} />}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button
              onClick={() => setIsPaletteOpen(true)}
              className="lp-btn-secondary"
              style={{ padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}
            >
              🔍 <kbd style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 4px', borderRadius: 3, fontSize: 10, fontFamily: 'var(--font-mono)' }}>Ctrl+K</kbd>
            </button>
            {user && <NotificationCenter user={user} />}
          </div>
        </div>
      </header>

      <main className="lp-main" style={{ overflowY: 'auto' }}>
        <div style={{ maxWidth: 820, margin: '0 auto', padding: '0 48px', paddingBottom: 60 }}>

        {/* Global error */}
        {error && (
          <div className="lp-status-bar error" style={{ marginBottom: 24 }}>
            ⚠️ {error}
            <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── PHASE: PICK ── */}
        {(phase === 'pick') && (
          <div className="fade-in">
            <h2 style={{ marginBottom: 4 }}>Import Git Repository</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>
              Select a repository — LaunchLive will automatically detect your stack, branches, and environment variables.
            </p>

            <div className="lp-card" style={{ padding: 24 }}>
              <input
                className="lp-search"
                placeholder="Search repositories…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ marginBottom: 16 }}
                autoFocus
              />

              {loadingRepos ? (
                <div className="flex-center" style={{ padding: 48, gap: 12, flexDirection: 'column' }}>
                  <div className="loading-spinner" />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading your repositories…</span>
                </div>
              ) : (
                <div style={{ maxHeight: 420, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {filtered.length === 0 ? (
                    <div className="flex-center" style={{ padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>No repositories found</div>
                  ) : filtered.map(repo => (
                    <div
                      key={repo.id}
                      onClick={() => handleSelectRepo(repo)}
                      style={{
                        padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                        border: '1px solid var(--border)', transition: 'all 0.15s',
                        background: 'rgba(255,255,255,0.02)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.background = 'rgba(56,189,248,0.04)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'rgba(255,255,255,0.02)'; }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{repo.fullName}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                            {repo.language || 'Unknown'} · {repo.private ? '🔒 Private' : 'Public'} · {repo.defaultBranch}
                          </div>
                        </div>
                      </div>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"><polyline points="9 18 15 12 9 6"/></svg>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── PHASE: ANALYZE ── */}
        {phase === 'analyze' && (
          <div className="fade-in flex-center" style={{ flexDirection: 'column', gap: 32, paddingTop: 60, maxWidth: 500, margin: '0 auto' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 72, height: 72, borderRadius: '50%',
                background: 'linear-gradient(135deg, rgba(56,189,248,0.1), rgba(129,140,248,0.1))',
                border: '2px solid rgba(56,189,248,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                animation: scanStep < 3 ? 'spin 2s linear infinite' : 'none',
                boxShadow: '0 0 20px rgba(56, 189, 248, 0.15)',
                transition: 'all 0.5s ease'
              }}>
                <span style={{ fontSize: 28, transform: scanStep === 3 ? 'scale(1.2)' : 'none', transition: 'all 0.3s' }}>
                  {scanStep === 3 ? '🎉' : '🔍'}
                </span>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontWeight: 700, fontSize: 18, color: 'var(--text-main)' }}>Analyzing {selected?.name}</div>
                <div style={{ color: 'var(--text-dim)', fontSize: 13, marginTop: 4 }}>LaunchPad AI-scanner is examining your repository</div>
              </div>
            </div>

            <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
              {[
                { id: 0, label: 'Stack & Framework Scan', detail: scanDetails.stack },
                { id: 1, label: 'Branch Mapping', detail: scanDetails.branch },
                { id: 2, label: 'Environment Discovery', detail: scanDetails.env }
              ].map(step => {
                const isActive = scanStep === step.id;
                const isCompleted = scanStep > step.id;
                const isPending = scanStep < step.id;

                let iconColor = 'var(--text-dim)';
                let iconContent = (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><circle cx="12" cy="12" r="10"/></svg>
                );
                
                if (isActive) {
                  iconColor = 'var(--accent-primary)';
                  iconContent = (
                    <div className="loading-spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)' }} />
                  );
                } else if (isCompleted) {
                  iconColor = '#10b981';
                  iconContent = (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  );
                }

                return (
                  <div key={step.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', opacity: isPending ? 0.4 : 1, transition: 'all 0.3s' }}>
                    <div style={{ color: iconColor, marginTop: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16 }}>
                      {iconContent}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: isActive ? 'var(--text-main)' : 'var(--text-dim)' }}>
                        {step.label}
                      </span>
                      <span style={{ fontSize: 12, color: isActive ? 'var(--accent-primary)' : isCompleted ? '#34d399' : 'var(--text-muted)' }}>
                        {step.detail}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── PHASE: REVIEW ── */}
        {phase === 'review' && analysis && (
          <div className="fade-in">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>Ready to Deploy</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  LaunchLive has auto-configured everything. Review and deploy in one click.
                </p>
              </div>
              <button className="lp-btn-secondary" style={{ fontSize: 12 }} onClick={() => { setPhase('pick'); setSelected(null); setAnalysis(null); }}>
                ← Change Repo
              </button>
            </div>

            {analyzeErr && (
              <div className="lp-status-bar" style={{ marginBottom: 16, borderColor: 'rgba(251,191,36,0.3)', background: 'rgba(251,191,36,0.05)' }}>
                ⚠️ {analyzeErr}
              </div>
            )}

            {/* Project Settings Card */}
            <div className="lp-card" style={{ padding: 24, marginBottom: 16, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 6 }}>PROJECT SETTINGS</div>
              <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 16px 0' }}>
                Your project name determines your default deployment URL. Subdomains must be alphanumeric and can contain hyphens.
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <label style={{ fontSize: 12, color: 'var(--text-main)', fontWeight: 600 }}>Project Name / Subdomain</label>
                  <input
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    placeholder="e.g. my-awesome-app"
                    className="lp-input"
                    style={{ height: 42, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '0 14px', fontSize: 14, color: 'var(--text-main)' }}
                  />
                </div>
                
                {/* Subdomain availability indicator */}
                {projectName.trim() && (
                  <div style={{ marginTop: 4 }}>
                    {checkingSubdomain ? (
                      <div className="flex-center" style={{ gap: 8, fontSize: 12, color: 'var(--text-muted)', justifyContent: 'flex-start' }}>
                        <div className="loading-spinner" style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)' }} />
                        <span>Checking domain availability...</span>
                      </div>
                    ) : subdomainAvailable === true ? (
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 8,
                        background: 'rgba(16, 185, 129, 0.03)', border: '1px solid rgba(16, 185, 129, 0.15)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#10b981', fontWeight: 600 }}>
                          <span>✓</span> Subdomain is available!
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--accent-primary)', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                          https://{projectName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.{domain}
                        </div>
                      </div>
                    ) : subdomainAvailable === false ? (
                      <div style={{
                        display: 'flex', flexDirection: 'column', gap: 4, padding: 12, borderRadius: 8,
                        background: 'rgba(239, 68, 68, 0.03)', border: '1px solid rgba(239, 68, 68, 0.15)'
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
                          <span>✗</span> Subdomain already exists!
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Please choose another project name to get a unique deployment URL.
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>
            </div>

            {/* Auto-detected config card */}
            <div className="lp-card" style={{ padding: 24, marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 16 }}>AUTO-DETECTED CONFIGURATION</div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                {/* Stack */}
                <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>DETECTED STACK</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 22 }}>{stackMeta.icon}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: 14, color: stackMeta.color }}>{stackMeta.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-dim)' }}>AI Detected</div>
                    </div>
                  </div>
                </div>

                {/* Branch selector */}
                <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>DEPLOY BRANCH</div>
                  <select
                    value={branch}
                    onChange={e => setBranch(e.target.value)}
                    style={{
                      width: '100%', background: 'var(--bg-card)', border: '1px solid var(--border)',
                      color: 'var(--text-main)', borderRadius: 6, padding: '6px 10px', fontSize: 13,
                    }}
                  >
                    {(analysis.branches || [branch]).map(b => (
                      <option key={b} value={b}>{b}{b === analysis.defaultBranch ? ' (default)' : ''}</option>
                    ))}
                  </select>
                </div>

                {/* Repo */}
                <div style={{ padding: '16px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginBottom: 8 }}>REPOSITORY</div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{selected?.fullName}</div>
                  {analysis.language && <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 2 }}>{analysis.language}</div>}
                </div>
              </div>
            </div>

            {/* Environment Variables */}
            <div className="lp-card" style={{ padding: 24, marginBottom: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>ENVIRONMENT VARIABLES</div>
                  {envVars.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                      {analysis.hasEnvExample ? `📋 Auto-scanned from .env.example` : 'Manually configured'}
                      {missingCount > 0 && <span style={{ color: '#fbbf24', marginLeft: 8 }}>⚠️ {missingCount} required value{missingCount !== 1 ? 's' : ''} need filling</span>}
                    </div>
                  )}
                </div>
                <div>
                  <button onClick={addEnvRow} className="lp-btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }}>+ Add Variable</button>
                </div>
              </div>

              {envVars.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--text-dim)', fontSize: 13 }}>
                  <div style={{ fontSize: 24, marginBottom: 8 }}>✨</div>
                  <div>No environment variables detected in this repository.</div>
                  <div style={{ fontSize: 12, marginTop: 4 }}>You can add them later from the project settings.</div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                  
                  {/* Category 1: Required from you */}
                  {(() => {
                    const requiredItems = envVars.map((env, idx) => ({ env, idx })).filter(item => !isAutoConfigured(item.env.key) && isSensitive(item.env.key) && !isOptional(item.env.key));
                    if (requiredItems.length === 0) return null;
                    return (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: '#fbbf24', display: 'flex', alignItems: 'center', gap: 4 }}>
                            ⚠️ Required from you ({requiredItems.length})
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>— sensitive values that must be entered to deploy</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {requiredItems.map(({ env, idx }) => {
                            const isMissing = !env.value.trim() || env.value.includes('placeholder') || env.value.includes('your_');
                            const isDbKey = ['MONGO', 'DATABASE', 'DB_URL'].some(dbw => env.key.includes(dbw));
                            const isStripe = env.key.includes('STRIPE');
                            const isSendGrid = env.key.includes('SENDGRID') || env.key.includes('SMTP');
                            const isCloudinary = env.key.includes('CLOUDINARY');
                            return (
                              <div key={idx} style={{ background: 'rgba(245, 158, 11, 0.03)', border: isMissing ? '1px solid rgba(245, 158, 11, 0.3)' : '1px solid var(--border)', borderRadius: '10px', padding: '12px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                  <code style={{ fontSize: '12px', fontWeight: '700', color: 'var(--text)' }}>{env.key}</code>
                                  <span style={{ fontSize: '9px', padding: '2px 8px', borderRadius: '100px', background: 'rgba(245, 158, 11, 0.1)', color: '#fbbf24', fontWeight: '700', letterSpacing: '0.05em' }}>REQUIRED</span>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                  <input
                                    type={revealed[env.key] ? 'text' : 'password'}
                                    placeholder={`Enter value for ${env.key.toLowerCase().replace(/_/g, ' ')}...`}
                                    value={env.value}
                                    onChange={e => updateEnv(idx, 'value', e.target.value)}
                                    className="lp-input"
                                    style={{
                                      fontSize: 12,
                                      fontFamily: 'monospace',
                                      borderColor: isMissing ? 'rgba(239, 68, 68, 0.4)' : undefined,
                                      boxShadow: isMissing ? '0 0 4px rgba(239, 68, 68, 0.1)' : undefined
                                    }}
                                  />
                                  <button onClick={() => setRevealed(p => ({ ...p, [env.key]: !p[env.key] }))} className="lp-btn-secondary" style={{ padding: '0 12px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                    {revealed[env.key] ? '🙈 Hide' : '👁 Show'}
                                  </button>
                                  <button onClick={() => removeEnvRow(idx)} style={{
                                    background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                    color: 'var(--accent-danger)', cursor: 'pointer', height: 32, width: 32, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center'
                                  }}>✕</button>
                                </div>
                                {/* Help hints */}
                                {isDbKey && (
                                  <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '6px', opacity: 0.8 }}>
                                    💡 Get a free MongoDB URI at <a href="https://mongodb.com/atlas" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>mongodb.com/atlas</a>
                                  </div>
                                )}
                                {isStripe && (
                                  <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '6px', opacity: 0.8 }}>
                                    💡 Get your keys from the <a href="https://dashboard.stripe.com/apikeys" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>Stripe Dashboard</a>
                                  </div>
                                )}
                                {isSendGrid && (
                                  <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '6px', opacity: 0.8 }}>
                                    💡 Get a free API key at <a href="https://sendgrid.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>sendgrid.com</a>
                                  </div>
                                )}
                                {isCloudinary && (
                                  <div style={{ fontSize: '11px', color: '#fbbf24', marginTop: '6px', opacity: 0.8 }}>
                                    💡 Get free storage at <a href="https://cloudinary.com" target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'underline' }}>cloudinary.com</a>
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Category 2: Auto-configured */}
                  {(() => {
                    const autoItems = envVars.map((env, idx) => ({ env, idx })).filter(item => isAutoConfigured(item.env.key));
                    if (autoItems.length === 0) return null;
                    return (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                              ✅ Auto-configured ({autoItems.length})
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>— safely generated/provisioned automatically</span>
                          </div>
                        </div>
                        <div style={{ background: 'rgba(16, 185, 129, 0.02)', border: '1px solid rgba(16, 185, 129, 0.2)', borderRadius: '10px', padding: '12px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 16px' }}>
                            {autoItems.map(({ env, idx }) => {
                              let typeLabel = 'DEFAULT';
                              let placeholderText = env.placeholder || 'Auto';
                              
                              const uKey = env.key.toUpperCase();
                              if (isAutoGen(env.key)) {
                                typeLabel = 'GENERATED';
                                placeholderText = '[auto-generated]';
                              } else if (['DATABASE_URL', 'DATABASE_URI', 'MONGODB_URI', 'MONGO_URI', 'REDIS_URL', 'REDIS_HOST', 'REDIS_PORT'].includes(uKey)) {
                                typeLabel = 'PROVISIONED';
                                placeholderText = '[auto-provisioned]';
                              } else if (['GEMINI_API_KEY', 'GROQ_API_KEY'].includes(uKey)) {
                                typeLabel = 'API KEY';
                                placeholderText = '[auto-configured]';
                              } else if (hasDefault(env.key)) {
                                typeLabel = 'DEFAULT';
                                placeholderText = AUTO_DEFAULTS[uKey];
                              }

                              return (
                                <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '6px 8px', background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.02)', borderRadius: 8 }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <code style={{ fontSize: '11px', fontWeight: '600', color: 'var(--text-dim)' }}>{env.key}</code>
                                    <span style={{ fontSize: '8px', padding: '1px 5px', borderRadius: '4px', background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', fontWeight: '700', letterSpacing: '0.05em' }}>{typeLabel}</span>
                                  </div>
                                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 2 }}>
                                    <input
                                      type="text"
                                      value={env.value}
                                      placeholder={placeholderText}
                                      onChange={e => updateEnv(idx, 'value', e.target.value)}
                                      className="lp-input"
                                      style={{
                                        fontSize: 11,
                                        height: 24,
                                        padding: '2px 8px',
                                        background: env.value ? undefined : 'transparent',
                                        border: env.value ? undefined : '1px dashed var(--border)',
                                        opacity: env.value ? 1 : 0.6
                                      }}
                                    />
                                    <button onClick={() => removeEnvRow(idx)} style={{
                                      background: 'none', border: 'none',
                                      color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, padding: '0 4px'
                                    }}>✕</button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Category 3: Optional */}
                  {(() => {
                    const optionalItems = envVars.map((env, idx) => ({ env, idx })).filter(item => !isAutoConfigured(item.env.key) && (!isSensitive(item.env.key) || isOptional(item.env.key)));
                    if (optionalItems.length === 0) return null;
                    return (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', display: 'flex', alignItems: 'center', gap: 4 }}>
                            ℹ️ Optional ({optionalItems.length})
                          </span>
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>— can be added or edited anytime later</span>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                          {optionalItems.map(({ env, idx }) => (
                            <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 32px', gap: 8, alignItems: 'center' }}>
                              <input
                                value={env.key}
                                onChange={e => updateEnv(idx, 'key', e.target.value.toUpperCase())}
                                placeholder="VARIABLE_NAME"
                                className="lp-input lp-input-mono"
                                style={{ fontSize: 12, background: env.fromExample ? 'rgba(255,255,255,0.02)' : undefined }}
                                readOnly={env.fromExample}
                              />
                              <input
                                value={env.value}
                                onChange={e => updateEnv(idx, 'value', e.target.value)}
                                placeholder={env.placeholder || 'optional'}
                                className="lp-input"
                                style={{ fontSize: 12 }}
                              />
                              <button onClick={() => removeEnvRow(idx)} style={{
                                background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                                color: 'var(--accent-danger)', cursor: 'pointer', height: 32, width: 32, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center'
                              }}>✕</button>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                </div>
              )}
            </div>

            {/* Deploy Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 16 }}>
              {missingCount > 0 && (
                <div style={{ color: '#fca5a5', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, fontWeight: 600 }}>
                  ⚠️ {missingCount} required variable{missingCount !== 1 ? 's' : ''} need value{missingCount !== 1 ? 's' : ''}
                </div>
              )}
              <button
                className={`lp-btn-primary ${deploying ? 'animate-pulse-cyan' : ''}`}
                onClick={handleDeploy}
                disabled={deploying || !selected || subdomainAvailable === false || checkingSubdomain || !projectName.trim() || missingCount > 0}
                style={{
                  minWidth: 220,
                  justifyContent: 'center',
                  fontSize: 15,
                  padding: '12px 28px',
                  background: missingCount > 0 ? 'rgba(239, 68, 68, 0.2)' : undefined,
                  border: missingCount > 0 ? '1px solid rgba(239, 68, 68, 0.4)' : undefined,
                  color: missingCount > 0 ? '#fca5a5' : undefined,
                  boxShadow: missingCount > 0 ? 'none' : undefined,
                  cursor: missingCount > 0 ? 'not-allowed' : 'pointer'
                }}
              >
                {deploying ? (
                  <><div className="loading-spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> Deploying…</>
                ) : missingCount > 0 ? (
                  <>⚠️ Enter Required Env Vars</>
                ) : (
                  <>🚀 Deploy {selected?.name}</>
                )}
              </button>
            </div>
          </div>
        )}

        </div>{/* /inner-wrapper */}
      </main>

      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
      />

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}