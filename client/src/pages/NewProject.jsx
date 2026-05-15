import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

const FRAMEWORKS = [
  { id: 'auto',           label: 'Auto Detect',       icon: '🔍', desc: 'LaunchPad will detect your framework automatically' },
  { id: 'react',          label: 'React / Frontend',   icon: '⚛️',  desc: 'React, Vite, Vue, Angular, or any SPA' },
  { id: 'node',           label: 'Node.js Backend',    icon: '🟢', desc: 'Express, Fastify, or any Node API' },
  { id: 'mern',           label: 'MERN (Unified)',     icon: '📦',  desc: 'Frontend + Backend in one repository' },
  { id: 'fullstack-split',label: 'Full-Stack (Split)',  icon: '🏗️',  desc: 'Separate /frontend and /backend folders' },
  { id: 'static',         label: 'Static Website',     icon: '📄', desc: 'Simple HTML/CSS/JS without a server' },
  { id: 'next',           label: 'Next.js / SSR',      icon: '▲',  desc: 'Next.js full-stack framework' },
];

export default function NewProject() {
  const navigate = useNavigate();

  const [step, setStep] = useState(1);
  const [repos,    setRepos]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);
  const [branch,    setBranch]    = useState('main');
  const [framework, setFramework] = useState('auto');
  
  const [installCmd, setInstallCmd] = useState('');
  const [buildCmd,   setBuildCmd]   = useState('');
  const [outDir,     setOutDir]     = useState('');
  const [showAdv,    setShowAdv]    = useState(false);

  const [envVars,  setEnvVars]  = useState([{ key: '', value: '' }]);
  const [creating, setCreating] = useState(false);
  const [error,    setError]    = useState('');

  useEffect(() => {
    api.get('/projects/repos')
      .then(res => setRepos(res.data.repos))
      .catch(err => setError(err.response?.data?.message || 'Failed to load GitHub repos'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = repos.filter(r =>
    r.fullName.toLowerCase().includes(search.toLowerCase())
  );

  const addEnvRow    = () => setEnvVars(v => [...v, { key: '', value: '' }]);
  const removeEnvRow = (i) => setEnvVars(v => v.filter((_, idx) => idx !== i));
  const updateEnv    = (i, field, val) =>
    setEnvVars(v => v.map((e, idx) => idx === i ? { ...e, [field]: val } : e));

  const handleDeploy = async () => {
    if (!selected) return;
    setCreating(true); setError('');
    try {
      const res = await api.post('/projects', {
        repoFullName: selected.fullName,
        branch,
        name:           selected.name,
        framework:      framework === 'auto' ? undefined : framework,
        installCommand: installCmd || undefined,
        buildCommand:   buildCmd   || undefined,
        outputDir:      outDir     || undefined,
      });
      const projectId = res.data.project._id;

      const validEnvs = envVars.filter(e => e.key.trim() && e.value.trim());
      for (const env of validEnvs) {
        await api.post(`/env/${projectId}`, { key: env.key.trim(), value: env.value.trim() });
      }

      await api.post(`/deploy/${projectId}`);
      navigate(`/projects/${projectId}`);
    } catch (err) {
      setError(err.response?.data?.message || 'Deployment failed');
      setCreating(false);
    }
  };

  return (
    <div className="launchpad-container">
      <header className="lp-header">
        <div className="lp-logo" onClick={() => navigate('/dashboard')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
          </svg>
          LaunchPad
        </div>
        <button className="lp-btn-secondary" onClick={() => navigate('/dashboard')}>Cancel</button>
      </header>

      <main className="lp-main" style={{ maxWidth: '1000px', margin: '48px auto', padding: '0 20px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 48, marginBottom: 48 }}>
          {[1, 2, 3].map(s => (
            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ 
                width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', 
                justifyContent: 'center', fontWeight: 700, fontSize: 14,
                background: step >= s ? 'var(--gradient-primary)' : 'var(--border)',
                color: 'white', transition: 'all 0.3s'
              }}>{s}</div>
              <span style={{ 
                fontSize: 14, fontWeight: step === s ? 700 : 500, 
                color: step >= s ? 'var(--text-main)' : 'var(--text-dim)' 
              }}>
                {s === 1 ? 'Import' : s === 2 ? 'Configure' : 'Environment'}
              </span>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 32, marginBottom: 12 }}>
            {step === 1 ? 'Select a Repository' : step === 2 ? 'Project Configuration' : 'Environment Variables'}
          </h1>
        </div>

        {error && (
          <div className="glass" style={{ border: '1px solid var(--accent-danger)', padding: 16, borderRadius: 12, color: 'var(--accent-danger)', marginBottom: 32 }}>
            {error}
          </div>
        )}

        {/* ── Step 1: Repo Picker ── */}
        {step === 1 && (
          <div className="lp-card glass" style={{ padding: 32 }}>
            <input
              className="lp-search"
              placeholder="Search your repositories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', maxWidth: 'none', paddingLeft: 48, marginBottom: 24 }}
            />

            {loading ? (
              <div className="flex-center" style={{ padding: 60, flexDirection: 'column', gap: 20 }}>
                <div className="loading-spinner"></div>
                <span className="text-muted">Fetching repositories...</span>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 400, overflowY: 'auto' }}>
                {filtered.map(repo => (
                  <div
                    key={repo.id}
                    onClick={() => { setSelected(repo); setBranch(repo.defaultBranch || 'main'); }}
                    style={{
                      padding: '16px 20px', borderRadius: 12, cursor: 'pointer',
                      border: '1px solid',
                      borderColor: selected?.id === repo.id ? 'var(--accent-primary)' : 'var(--border)',
                      background: selected?.id === repo.id ? 'rgba(56, 189, 248, 0.05)' : 'transparent',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      transition: 'all 0.2s'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                      <div style={{ fontWeight: 600 }}>{repo.fullName}</div>
                    </div>
                    {selected?.id === repo.id && <span className="lp-badge live" style={{ fontSize: 10 }}>Selected</span>}
                  </div>
                ))}
              </div>
            )}

            {selected && (
              <div style={{ marginTop: 32, textAlign: 'right' }}>
                <button className="lp-btn-primary" onClick={() => setStep(2)}>Configure Build →</button>
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Build Config ── */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="lp-card glass" style={{ padding: 32 }}>
               <div style={{ marginBottom: 32 }}>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Branch</label>
                <input value={branch} onChange={e => setBranch(e.target.value)} className="lp-search" style={{ maxWidth: 300, backgroundImage: 'none', paddingLeft: 16 }} />
              </div>

              <label style={{ display: 'block', fontSize: 14, fontWeight: 700, marginBottom: 16 }}>Framework Preset</label>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 16, marginBottom: 32 }}>
                {FRAMEWORKS.map(fw => (
                  <div key={fw.id} onClick={() => setFramework(fw.id)}
                    style={{
                      padding: '20px', borderRadius: 16, cursor: 'pointer', transition: 'all 0.2s',
                      border: '2px solid',
                      borderColor: framework === fw.id ? 'var(--accent-primary)' : 'var(--border)',
                      background: framework === fw.id ? 'rgba(56, 189, 248, 0.05)' : 'rgba(255, 255, 255, 0.02)',
                    }}>
                    <div style={{ fontSize: 24, marginBottom: 8 }}>{fw.icon}</div>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{fw.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fw.desc}</div>
                  </div>
                ))}
              </div>

              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
                <button onClick={() => setShowAdv(!showAdv)} style={{ background: 'none', border: 'none', color: 'var(--accent-primary)', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                  {showAdv ? '▼' : '▶'} Build and Output Settings
                </button>
                {showAdv && (
                  <div style={{ marginTop: 24, display: 'grid', gap: 20 }}>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>INSTALL COMMAND</label>
                      <input value={installCmd} onChange={e => setInstallCmd(e.target.value)} placeholder="npm install" className="lp-search" style={{ width: '100%', backgroundImage: 'none', paddingLeft: 16 }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>BUILD COMMAND</label>
                      <input value={buildCmd} onChange={e => setBuildCmd(e.target.value)} placeholder="npm run build" className="lp-search" style={{ width: '100%', backgroundImage: 'none', paddingLeft: 16 }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 8 }}>OUTPUT DIRECTORY</label>
                      <input value={outDir} onChange={e => setOutDir(e.target.value)} placeholder="dist" className="lp-search" style={{ width: '100%', backgroundImage: 'none', paddingLeft: 16 }} />
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div className="flex-between">
              <button className="lp-btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="lp-btn-primary" onClick={() => setStep(3)}>Next: Environment →</button>
            </div>
          </div>
        )}

        {/* ── Step 3: Env Vars ── */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="lp-card glass" style={{ padding: 32 }}>
              <div style={{ marginBottom: 32 }}>
                <h3 style={{ margin: '0 0 8px' }}>Environment Variables</h3>
                <p className="text-muted">These secrets will be encrypted and injected at build time.</p>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
                {envVars.map((env, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12 }}>
                    <input value={env.key} onChange={e => updateEnv(i, 'key', e.target.value.toUpperCase())} placeholder="KEY" className="lp-search mono" style={{ flex: 1, backgroundImage: 'none', paddingLeft: 16, color: 'var(--accent-primary)' }} />
                    <input value={env.value} onChange={e => updateEnv(i, 'value', e.target.value)} placeholder="VALUE" type="password" className="lp-search" style={{ flex: 2, backgroundImage: 'none', paddingLeft: 16 }} />
                    <button onClick={() => removeEnvRow(i)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent-danger)' }}>✕</button>
                  </div>
                ))}
              </div>

              <button onClick={addEnvRow} className="lp-btn-secondary" style={{ width: '100%', borderStyle: 'dashed' }}>+ Add Variable</button>
            </div>

            <div className="flex-between">
              <button className="lp-btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <button className={`lp-btn-primary ${creating ? 'animate-pulse-cyan' : ''}`} onClick={handleDeploy} disabled={creating} style={{ minWidth: 240 }}>
                {creating ? 'Initializing...' : `Deploy ${selected?.name} 🚀`}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}