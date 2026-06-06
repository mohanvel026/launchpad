import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

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

export default function NewProject() {
  const navigate = useNavigate();

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
  const [showAll,   setShowAll]   = useState(false); // show all env fields vs just missing

  // Custom project name & subdomain live validation
  const [projectName, setProjectName] = useState('');
  const [subdomainAvailable, setSubdomainAvailable] = useState(null);
  const [checkingSubdomain, setCheckingSubdomain] = useState(false);

  useEffect(() => {
    if (!projectName.trim()) {
      setSubdomainAvailable(null);
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

  // ── Pick repo → trigger analysis ───────────────────────────────────────────
  const handleSelectRepo = useCallback(async (repo) => {
    setSelected(repo);
    setProjectName(repo.name || '');
    setPhase('analyze');
    setAnalyzeErr('');
    setAnalysis(null);

    try {
      const res = await api.post('/projects/repos/analyze', { repoFullName: repo.fullName });
      const data = res.data;
      setAnalysis(data);
      setBranch(data.defaultBranch || 'main');

      // Pre-populate env vars from .env.example
      if (data.envExampleVars?.length > 0) {
        setEnvVars(data.envExampleVars.map(v => ({
          key: v.key,
          value: v.placeholder || '',
          fromExample: true,
          filled: !!v.placeholder,
        })));
      } else {
        setEnvVars([]);
      }
      setPhase('review');
    } catch (e) {
      setAnalyzeErr(e.response?.data?.message || 'Could not analyze repo. You can still deploy manually.');
      setPhase('review');
      setAnalysis({ stack: 'unknown', branches: [repo.defaultBranch || 'main'], defaultBranch: repo.defaultBranch || 'main', envExampleVars: [] });
      setBranch(repo.defaultBranch || 'main');
      setEnvVars([]);
    }
  }, []);

  // ── Env helpers ────────────────────────────────────────────────────────────
  const updateEnv   = (i, field, val) => setEnvVars(v => v.map((e, idx) => idx === i ? { ...e, [field]: val } : e));
  const addEnvRow   = () => setEnvVars(v => [...v, { key: '', value: '', fromExample: false }]);
  const removeEnvRow= (i) => setEnvVars(v => v.filter((_, idx) => idx !== i));

  const missingCount = envVars.filter(e => e.fromExample && !e.value.trim()).length;

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
    <div className="launchpad-container" style={{ minHeight: '100vh' }}>
      {/* Header */}
      <header className="lp-header">
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
        <div style={{ width: 80 }} />
      </header>

      <main className="lp-main" style={{ maxWidth: 820, margin: '0 auto', width: '100%', paddingTop: 48 }}>

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
              Select a repository — LaunchPad will automatically detect your stack, branches, and environment variables.
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
          <div className="fade-in flex-center" style={{ flexDirection: 'column', gap: 20, paddingTop: 80 }}>
            <div style={{
              width: 72, height: 72, borderRadius: '50%',
              background: 'linear-gradient(135deg, rgba(56,189,248,0.15), rgba(129,140,248,0.15))',
              border: '2px solid rgba(56,189,248,0.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              animation: 'spin 1.5s linear infinite',
            }}>
              <span style={{ fontSize: 28 }}>🔍</span>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8 }}>Analyzing {selected?.name}…</div>
              <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>AI is detecting your stack, branches, and environment variables</div>
            </div>
            <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
              {['Stack Detection', 'Branch Listing', 'Env Discovery'].map((label, i) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="loading-spinner" style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: i === 0 ? '#38bdf8' : i === 1 ? '#818cf8' : '#22c55e', animationDelay: `${i * 0.2}s` }} />
                  <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{label}</span>
                </div>
              ))}
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
                  LaunchPad has auto-configured everything. Review and deploy in one click.
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
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.08em', marginBottom: 16 }}>PROJECT SETTINGS</div>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <label style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 600 }}>Project Name (defines your URL)</label>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <input
                    value={projectName}
                    onChange={e => setProjectName(e.target.value)}
                    placeholder="e.g. my-awesome-app"
                    className="lp-input"
                    style={{ flex: 1, height: 42, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0 14px', fontSize: 14 }}
                  />
                </div>
                
                {/* Subdomain availability indicator */}
                {projectName.trim() && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 4 }}>
                    {checkingSubdomain ? (
                      <>
                        <div className="loading-spinner" style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.1)', borderTopColor: 'var(--accent-primary)' }} />
                        <span style={{ color: 'var(--text-muted)' }}>Checking URL availability...</span>
                      </>
                    ) : subdomainAvailable === true ? (
                      <>
                        <span style={{ color: '#10b981' }}>🟢</span>
                        <span style={{ color: '#10b981', fontWeight: 600 }}>Available:</span>
                        <code style={{ color: 'var(--accent-primary)' }}>{projectName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.129.159.22.142.nip.io</code>
                      </>
                    ) : subdomainAvailable === false ? (
                      <>
                        <span style={{ color: '#ef4444' }}>🔴</span>
                        <span style={{ color: '#ef4444', fontWeight: 600 }}>Already Taken:</span>
                        <code style={{ color: 'var(--text-muted)', textDecoration: 'line-through' }}>{projectName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')}.129.159.22.142.nip.io</code>
                      </>
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-dim)', letterSpacing: '0.08em' }}>ENVIRONMENT VARIABLES</div>
                  {envVars.length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>
                      {analysis.hasEnvExample ? `📋 Auto-imported from .env.example` : 'Manually configured'}
                      {missingCount > 0 && <span style={{ color: '#f59e0b', marginLeft: 8 }}>⚠️ {missingCount} value{missingCount !== 1 ? 's' : ''} need filling</span>}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {envVars.length > 0 && (
                    <button onClick={() => setShowAll(s => !s)} className="lp-btn-secondary" style={{ padding: '5px 12px', fontSize: 12 }}>
                      {showAll ? 'Hide filled' : 'Show all'}
                    </button>
                  )}
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
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {/* Header */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 32px', gap: 8, padding: '0 4px' }}>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 700 }}>KEY</span>
                    <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 700 }}>VALUE</span>
                  </div>
                  {envVars
                    .map((env, i) => ({ env, i }))
                    .filter(({ env }) => showAll || !env.fromExample || !env.value.trim())
                    .map(({ env, i }) => (
                      <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 2fr 32px', gap: 8, alignItems: 'center' }}>
                        <input
                          value={env.key}
                          onChange={e => updateEnv(i, 'key', e.target.value.toUpperCase())}
                          placeholder="VARIABLE_NAME"
                          className="lp-input lp-input-mono"
                          style={{ fontSize: 12, background: env.fromExample ? 'rgba(56,189,248,0.04)' : undefined }}
                          readOnly={env.fromExample}
                        />
                        <input
                          value={env.value}
                          onChange={e => updateEnv(i, 'value', e.target.value)}
                          placeholder={env.fromExample ? 'Required — enter value' : 'value'}
                          type={env.key?.includes('SECRET') || env.key?.includes('KEY') || env.key?.includes('PASSWORD') ? 'password' : 'text'}
                          className="lp-input"
                          style={{
                            fontSize: 12,
                            borderColor: env.fromExample && !env.value.trim() ? 'rgba(251,191,36,0.5)' : undefined,
                          }}
                        />
                        <button onClick={() => removeEnvRow(i)} style={{
                          background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                          color: 'var(--accent-danger)', cursor: 'pointer', height: 32, width: 32, fontSize: 13,
                        }}>✕</button>
                      </div>
                    ))}
                  {!showAll && envVars.filter(e => e.fromExample && e.value.trim()).length > 0 && (
                    <button onClick={() => setShowAll(true)} style={{
                      background: 'none', border: 'none', color: 'var(--text-dim)', fontSize: 12,
                      cursor: 'pointer', textAlign: 'left', padding: '4px 0',
                    }}>
                      + {envVars.filter(e => e.fromExample && e.value.trim()).length} more filled variable(s) — click to show
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Deploy Button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                className={`lp-btn-primary ${deploying ? 'animate-pulse-cyan' : ''}`}
                onClick={handleDeploy}
                disabled={deploying || !selected || subdomainAvailable === false || checkingSubdomain || !projectName.trim()}
                style={{ minWidth: 220, justifyContent: 'center', fontSize: 15, padding: '12px 28px' }}
              >
                {deploying ? (
                  <><div className="loading-spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> Deploying…</>
                ) : (
                  <>🚀 Deploy {selected?.name}</>
                )}
              </button>
            </div>
          </div>
        )}

      </main>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}