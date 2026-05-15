import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

const FRAMEWORKS = [
  { id: 'auto',            label: 'Auto Detect',       icon: '🔍', desc: 'LaunchPad detects your stack automatically' },
  { id: 'react',           label: 'React / Vite',       icon: '⚛️',  desc: 'React, Vue, Angular, Svelte, or any SPA' },
  { id: 'node',            label: 'Node.js API',        icon: '🟢', desc: 'Express, Fastify, or any Node.js server' },
  { id: 'mern',            label: 'MERN (Unified)',     icon: '📦', desc: 'Frontend + Backend in one repository' },
  { id: 'fullstack-split', label: 'Full-Stack (Split)', icon: '🏗️',  desc: 'Separate /frontend and /backend folders' },
  { id: 'next',            label: 'Next.js',            icon: '▲',  desc: 'Next.js SSR framework' },
  { id: 'static',          label: 'Static Site',        icon: '📄', desc: 'Plain HTML/CSS/JS files' },
];

export default function NewProject() {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);

  // Step 1
  const [repos,    setRepos]    = useState([]);
  const [loadingRepos, setLoadingRepos] = useState(true);
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);

  // Step 2
  const [branch,    setBranch]    = useState('main');
  const [framework, setFramework] = useState('auto');
  const [showAdv,   setShowAdv]   = useState(false);
  const [installCmd, setInstallCmd] = useState('');
  const [buildCmd,   setBuildCmd]   = useState('');
  const [outDir,     setOutDir]     = useState('');

  // Step 3
  const [envVars,  setEnvVars]  = useState([{ key: '', value: '' }]);
  const [bulkMode, setBulkMode] = useState(false);
  const [bulkText, setBulkText] = useState('');

  // Deploy
  const [creating, setCreating] = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    api.get('/projects/repos')
      .then(res => setRepos(res.data.repos || []))
      .catch(err => setError(err.response?.data?.message || 'Failed to load repositories'))
      .finally(() => setLoadingRepos(false));
  }, []);

  const filtered = repos.filter(r =>
    r.fullName?.toLowerCase().includes(search.toLowerCase())
  );

  const addEnvRow    = () => setEnvVars(v => [...v, { key: '', value: '' }]);
  const removeEnvRow = i => setEnvVars(v => v.filter((_, idx) => idx !== i));
  const updateEnv    = (i, field, val) => setEnvVars(v => v.map((e, idx) => idx === i ? { ...e, [field]: val } : e));

  const parseBulk = () => {
    const pairs = bulkText.split('\n').filter(l => l.includes('=') && !l.startsWith('#'));
    const parsed = pairs.map(l => {
      const eq = l.indexOf('=');
      return { key: l.slice(0, eq).trim(), value: l.slice(eq + 1).trim() };
    }).filter(e => e.key);
    setEnvVars(parsed.length ? parsed : [{ key: '', value: '' }]);
    setBulkMode(false);
  };

  const handleDeploy = async () => {
    if (!selected) return;
    setCreating(true); setError('');
    try {
      const res = await api.post('/projects', {
        repoFullName:   selected.fullName,
        branch,
        name:           selected.name,
        framework:      framework === 'auto' ? undefined : framework,
        installCommand: installCmd || undefined,
        buildCommand:   buildCmd   || undefined,
        outputDir:      outDir     || undefined,
      });
      const projectId = res.data.project._id;

      // Save env vars
      const valid = envVars.filter(e => e.key.trim() && e.value.trim());
      for (const env of valid) {
        await api.post(`/env/${projectId}`, { key: env.key.trim(), value: env.value.trim() });
      }

      // Trigger deployment
      await api.post(`/deploy/${projectId}`);
      navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Deployment failed. Please try again.');
      setCreating(false);
    }
  };

  const STEPS = ['Repository', 'Configure', 'Environment'];

  return (
    <div className="launchpad-container">
      <header className="lp-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button className="lp-btn-secondary" style={{ padding: '6px 12px', fontSize: 13 }} onClick={() => navigate('/dashboard')}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6"/></svg>
            Cancel
          </button>
          <div style={{ width: 1, height: 20, background: 'var(--border)' }} />
          <span style={{ fontWeight: 700, fontSize: 15 }}>New Project</span>
        </div>

        {/* Step indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {STEPS.map((s, i) => {
            const num = i + 1;
            const done = step > num;
            const active = step === num;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: 11, fontWeight: 700,
                  background: done ? 'var(--accent-success)' : active ? 'var(--gradient-primary)' : 'var(--border)',
                  color: (done || active) ? 'white' : 'var(--text-dim)',
                  transition: 'all 0.3s'
                }}>
                  {done ? '✓' : num}
                </div>
                <span style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--text-main)' : 'var(--text-dim)' }}>{s}</span>
                {i < STEPS.length - 1 && <div style={{ width: 24, height: 1, background: 'var(--border)', margin: '0 4px' }} />}
              </div>
            );
          })}
        </div>
        <div style={{ width: 80 }} />
      </header>

      <main className="lp-main" style={{ maxWidth: 780, margin: '0 auto', width: '100%', paddingTop: 48 }}>
        {error && (
          <div className="lp-status-bar error" style={{ marginBottom: 24 }}>
            ⚠️ {error}
            <button onClick={() => setError('')} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── Step 1: Pick repo ── */}
        {step === 1 && (
          <div className="fade-in">
            <h2 style={{ marginBottom: 6 }}>Import Git Repository</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>Select a GitHub repository to deploy.</p>

            <div className="lp-card" style={{ padding: 24 }}>
              <input className="lp-search" placeholder="Search repositories..." value={search} onChange={e => setSearch(e.target.value)} style={{ marginBottom: 16 }} />
              
              {loadingRepos ? (
                <div className="flex-center" style={{ padding: 48, gap: 12, flexDirection: 'column' }}>
                  <div className="loading-spinner" />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading your repositories…</span>
                </div>
              ) : (
                <div style={{ maxHeight: 380, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {filtered.length === 0 ? (
                    <div className="flex-center" style={{ padding: 32, color: 'var(--text-muted)', fontSize: 13 }}>No repositories found</div>
                  ) : filtered.map(repo => (
                    <div
                      key={repo.id}
                      onClick={() => { setSelected(repo); setBranch(repo.defaultBranch || 'main'); }}
                      className="flex-between"
                      style={{
                        padding: '12px 16px', borderRadius: 8, cursor: 'pointer',
                        border: '1px solid', transition: 'all 0.15s',
                        borderColor: selected?.id === repo.id ? 'var(--accent-primary)' : 'transparent',
                        background: selected?.id === repo.id ? 'rgba(56,189,248,0.04)' : 'rgba(255,255,255,0.02)',
                      }}
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
                      {selected?.id === repo.id && (
                        <div style={{ width: 20, height: 20, borderRadius: '50%', background: 'var(--accent-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
              <button className="lp-btn-primary" onClick={() => setStep(2)} disabled={!selected}>
                Continue <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Configure ── */}
        {step === 2 && (
          <div className="fade-in">
            <h2 style={{ marginBottom: 6 }}>Configure Project</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>Select your framework and customize build settings.</p>

            <div className="lp-card" style={{ padding: 28, marginBottom: 16 }}>
              {/* Branch */}
              <div style={{ marginBottom: 28 }}>
                <div className="lp-section-label">BRANCH</div>
                <input value={branch} onChange={e => setBranch(e.target.value)} placeholder="main" className="lp-input" style={{ maxWidth: 240 }} />
              </div>

              {/* Framework Grid */}
              <div className="lp-section-label" style={{ marginBottom: 12 }}>FRAMEWORK PRESET</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 28 }}>
                {FRAMEWORKS.map(fw => (
                  <div key={fw.id} onClick={() => setFramework(fw.id)} style={{
                    padding: '14px 16px', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                    border: '1px solid', borderColor: framework === fw.id ? 'var(--accent-primary)' : 'var(--border)',
                    background: framework === fw.id ? 'rgba(56,189,248,0.04)' : 'rgba(255,255,255,0.01)',
                  }}>
                    <div style={{ fontSize: 20, marginBottom: 6 }}>{fw.icon}</div>
                    <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{fw.label}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-dim)', lineHeight: 1.4 }}>{fw.desc}</div>
                  </div>
                ))}
              </div>

              {/* Advanced toggle */}
              <button onClick={() => setShowAdv(!showAdv)} style={{
                background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)',
                borderRadius: 6, padding: '8px 14px', cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8
              }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ transform: showAdv ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }}><polyline points="9 18 15 12 9 6"/></svg>
                Build & Output Settings {showAdv ? '' : '(optional)'}
              </button>

              {showAdv && (
                <div style={{ marginTop: 20, display: 'grid', gap: 16, padding: '20px', background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)' }}>
                  {[
                    { label: 'INSTALL COMMAND', val: installCmd, set: setInstallCmd, ph: 'npm install' },
                    { label: 'BUILD COMMAND',   val: buildCmd,   set: setBuildCmd,   ph: 'npm run build' },
                    { label: 'OUTPUT DIRECTORY',val: outDir,     set: setOutDir,     ph: 'dist' },
                  ].map(({ label, val, set, ph }) => (
                    <div key={label}>
                      <div className="lp-section-label">{label}</div>
                      <input value={val} onChange={e => set(e.target.value)} placeholder={ph} className="lp-input lp-input-mono" />
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex-between">
              <button className="lp-btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="lp-btn-primary" onClick={() => setStep(3)}>
                Continue <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6"/></svg>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Env vars ── */}
        {step === 3 && (
          <div className="fade-in">
            <h2 style={{ marginBottom: 6 }}>Environment Variables</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 28 }}>Add secrets that will be encrypted and injected at build time. You can skip this and add them later.</p>

            <div className="lp-card" style={{ padding: 28, marginBottom: 16 }}>
              <div className="flex-between" style={{ marginBottom: 20 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>{envVars.filter(e => e.key).length} variable{envVars.filter(e=>e.key).length !== 1 ? 's' : ''} set</span>
                <button onClick={() => setBulkMode(!bulkMode)} className="lp-btn-secondary" style={{ padding: '6px 14px', fontSize: 12 }}>
                  {bulkMode ? 'Switch to Manual' : '📋 Paste .env file'}
                </button>
              </div>

              {bulkMode ? (
                <div>
                  <div className="lp-section-label">PASTE .ENV CONTENT</div>
                  <textarea value={bulkText} onChange={e => setBulkText(e.target.value)}
                    placeholder={'DATABASE_URL=mongodb://...\nAPI_KEY=secret\nNODE_ENV=production'}
                    className="lp-input"
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 12, height: 180, marginBottom: 12 }}
                  />
                  <div style={{ display: 'flex', gap: 10 }}>
                    <button className="lp-btn-primary" onClick={parseBulk}>Parse & Add</button>
                    <button className="lp-btn-secondary" onClick={() => { setBulkMode(false); setBulkText(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8, padding: '0 4px' }}>
                    <span className="lp-section-label" style={{ flex: 1 }}>KEY</span>
                    <span className="lp-section-label" style={{ flex: 2 }}>VALUE</span>
                    <div style={{ width: 28 }} />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                    {envVars.map((env, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8 }}>
                        <input value={env.key} onChange={e => updateEnv(i, 'key', e.target.value.toUpperCase())}
                          placeholder="MY_SECRET_KEY" className="lp-input lp-input-mono" style={{ flex: 1 }} />
                        <input value={env.value} onChange={e => updateEnv(i, 'value', e.target.value)}
                          placeholder="value" type="password" className="lp-input" style={{ flex: 2 }} />
                        <button onClick={() => removeEnvRow(i)} style={{
                          background: 'none', border: '1px solid var(--border)', borderRadius: 6,
                          color: 'var(--accent-danger)', cursor: 'pointer', width: 32, flexShrink: 0, fontSize: 14
                        }}>✕</button>
                      </div>
                    ))}
                  </div>
                  <button onClick={addEnvRow} className="lp-btn-secondary" style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }}>
                    + Add Variable
                  </button>
                </div>
              )}
            </div>

            <div className="flex-between">
              <button className="lp-btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <button
                className={`lp-btn-primary ${creating ? 'animate-pulse-cyan' : ''}`}
                onClick={handleDeploy}
                disabled={creating}
                style={{ minWidth: 200, justifyContent: 'center' }}
              >
                {creating ? (
                  <><div className="loading-spinner" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: 'white' }} /> Deploying…</>
                ) : `🚀 Deploy ${selected?.name}`}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}