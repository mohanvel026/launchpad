import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';

const FRAMEWORKS = [
  { id: 'auto',           label: 'Auto Detect',       icon: '🔍', desc: 'LaunchPad will detect your framework automatically' },
  { id: 'react',          label: 'React / Vite',       icon: '⚛️',  desc: 'React, Vite, Vue, Angular, Svelte' },
  { id: 'next',           label: 'Next.js',            icon: '▲',  desc: 'Next.js full-stack framework' },
  { id: 'node',           label: 'Node / Express',     icon: '🟢', desc: 'Express, Fastify, or any Node.js server' },
  { id: 'fullstack-split',label: 'Full-Stack App',     icon: '🏗️',  desc: 'Separate frontend/ and backend/ folders' },
  { id: 'static',         label: 'Static Site',        icon: '📄', desc: 'Plain HTML, CSS, JavaScript' },
];

export default function NewProject() {
  const navigate = useNavigate();

  // Step management
  const [step, setStep] = useState(1); // 1=repo, 2=config, 3=env

  // Repo selection
  const [repos,    setRepos]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);

  // Config
  const [branch,    setBranch]    = useState('main');
  const [framework, setFramework] = useState('auto');

  // Env vars
  const [envVars,  setEnvVars]  = useState([{ key: '', value: '' }]);

  // State
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
    setCreating(true);
    setError('');
    try {
      // 1. Create project
      const res = await api.post('/projects', {
        repoFullName: selected.fullName,
        branch,
        name:      selected.name,
        framework: framework === 'auto' ? undefined : framework,
      });
      const projectId = res.data.project._id;

      // 2. Save env vars (filter empty rows)
      const validEnvs = envVars.filter(e => e.key.trim() && e.value.trim());
      for (const env of validEnvs) {
        await api.post(`/env/${projectId}`, { key: env.key.trim(), value: env.value.trim() });
      }

      // 3. Trigger first deployment
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
        <div className="lp-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#g2)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="g2" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#06B6D4"/><stop offset="100%" stopColor="#8B5CF6"/></linearGradient></defs>
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>
          </svg>
          LaunchPad
        </div>
        <button className="lp-btn-secondary" onClick={() => navigate('/dashboard')}>Cancel</button>
      </header>

      <main className="lp-main" style={{ maxWidth: '860px', marginTop: '40px' }}>

        {/* ── Step Indicators ── */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 40 }}>
          {['Select Repository', 'Configure', 'Environment'].map((s, i) => {
            const num = i + 1;
            const active = step === num;
            const done   = step > num;
            return (
              <div key={s} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: done ? 'pointer' : 'default' }}
                     onClick={() => done && setStep(num)}>
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontWeight: 700, fontSize: 14,
                    background: done ? 'var(--accent-gradient)' : active ? 'rgba(6,182,212,0.15)' : 'var(--bg-surface)',
                    border: active ? '2px solid var(--accent-cyan)' : done ? 'none' : '2px solid var(--border)',
                    color: done ? '#fff' : active ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  }}>
                    {done ? '✓' : num}
                  </div>
                  <span style={{ fontSize: 14, fontWeight: active ? 600 : 400, color: active ? 'var(--text-main)' : 'var(--text-muted)' }}>{s}</span>
                </div>
                {i < 2 && <div style={{ width: 60, height: 1, background: 'var(--border)', margin: '0 12px' }} />}
              </div>
            );
          })}
        </div>

        <h1 style={{ fontSize: 32, marginBottom: 8 }}>
          {step === 1 ? '🚀 Launch a New Project' : step === 2 ? '⚙️ Configure Deployment' : '🔐 Environment Variables'}
        </h1>
        <p style={{ color: 'var(--text-muted)', fontSize: 15, marginBottom: 32 }}>
          {step === 1 && 'Choose a GitHub repository to deploy to the LaunchPad edge network.'}
          {step === 2 && 'Set your branch, framework, and build configuration.'}
          {step === 3 && 'Add environment variables that will be injected at build time and runtime — just like Vercel and Render.'}
        </p>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', padding: 16, borderRadius: 12, color: '#F87171', marginBottom: 24, display: 'flex', justifyContent: 'space-between' }}>
            {error}
            <button onClick={() => setError('')} style={{ background: 'none', border: 'none', color: '#F87171', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ═══════ STEP 1: Select Repo ═══════ */}
        {step === 1 && (
          <div className="lp-card" style={{ padding: 32 }}>
            <input
              type="text"
              className="lp-search"
              placeholder="🔍  Search repositories..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ width: '100%', maxWidth: '100%', marginBottom: 24 }}
            />

            {loading ? (
              <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                <div className="spinner" style={{ width: 32, height: 32, margin: '0 auto 16px', borderTopColor: 'var(--accent-cyan)' }} />
                Loading your repositories…
              </div>
            ) : (
              <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', maxHeight: 420, overflowY: 'auto', background: 'rgba(255,255,255,0.02)' }}>
                {filtered.map(repo => (
                  <div
                    key={repo.id}
                    onClick={() => { setSelected(repo); setBranch(repo.defaultBranch || 'main'); }}
                    style={{
                      padding: '16px 20px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                      background: selected?.id === repo.id ? 'rgba(139,92,246,0.1)' : 'transparent',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'background 0.2s',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"/></svg>
                        {repo.fullName}
                      </div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                        {repo.language || 'Unknown'} · {repo.private ? '🔒 Private' : '🌐 Public'}
                        {repo.description && ` · ${repo.description.slice(0, 60)}`}
                      </div>
                    </div>
                    {selected?.id === repo.id && (
                      <span style={{ background: 'var(--accent-gradient)', color: '#fff', fontSize: 12, padding: '4px 12px', borderRadius: 100, fontWeight: 600 }}>Selected</span>
                    )}
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No repositories found</div>
                )}
              </div>
            )}

            {selected && (
              <div style={{ marginTop: 24, paddingTop: 24, borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                  Selected: <span style={{ color: 'var(--accent-cyan)', fontWeight: 600 }}>{selected.fullName}</span>
                </div>
                <button className="lp-btn-primary" onClick={() => setStep(2)}>
                  Continue →
                </button>
              </div>
            )}
          </div>
        )}

        {/* ═══════ STEP 2: Configure ═══════ */}
        {step === 2 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

            {/* Branch */}
            <div className="lp-card" style={{ padding: 28 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Branch to Deploy</div>
              <input
                value={branch}
                onChange={e => setBranch(e.target.value)}
                placeholder="main"
                style={{ background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: 8, fontSize: 14, width: '280px', fontFamily: 'var(--font-main)' }}
              />
            </div>

            {/* Framework */}
            <div className="lp-card" style={{ padding: 28 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Framework Preset</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
                LaunchPad will auto-detect your framework, but you can override it here.
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 }}>
                {FRAMEWORKS.map(fw => (
                  <div
                    key={fw.id}
                    onClick={() => setFramework(fw.id)}
                    style={{
                      padding: '16px 20px', borderRadius: 12, cursor: 'pointer', transition: 'all 0.2s',
                      border: framework === fw.id ? '2px solid var(--accent-cyan)' : '1px solid var(--border)',
                      background: framework === fw.id ? 'rgba(6,182,212,0.08)' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ fontSize: 22, marginBottom: 6 }}>{fw.icon}</div>
                    <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{fw.label}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{fw.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <button className="lp-btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button className="lp-btn-primary" onClick={() => setStep(3)}>Continue →</button>
            </div>
          </div>
        )}

        {/* ═══════ STEP 3: Env Vars ═══════ */}
        {step === 3 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div className="lp-card" style={{ padding: 28 }}>
              <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Environment Variables</div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 24 }}>
                These are encrypted and injected into your app at both <strong style={{ color: 'var(--accent-cyan)' }}>build time</strong> and <strong style={{ color: 'var(--accent-purple)' }}>runtime</strong>.
                For React/Vite apps, prefix variables with <code style={{ background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: 4 }}>VITE_</code>.
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {envVars.map((env, i) => (
                  <div key={i} style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                    <input
                      value={env.key}
                      onChange={e => updateEnv(i, 'key', e.target.value.toUpperCase())}
                      placeholder="VARIABLE_NAME"
                      style={{ background: 'var(--bg-main)', color: 'var(--accent-cyan)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: 8, fontSize: 13, fontFamily: 'monospace', width: '220px' }}
                    />
                    <input
                      value={env.value}
                      onChange={e => updateEnv(i, 'value', e.target.value)}
                      placeholder="value"
                      type="text"
                      style={{ background: 'var(--bg-main)', color: 'var(--text-main)', border: '1px solid var(--border)', padding: '12px 16px', borderRadius: 8, fontSize: 13, flex: 1 }}
                    />
                    <button onClick={() => removeEnvRow(i)} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.3)', color: '#F87171', borderRadius: 8, padding: '10px 14px', cursor: 'pointer', fontSize: 16 }}>✕</button>
                  </div>
                ))}
              </div>

              <button onClick={addEnvRow} className="lp-btn-secondary" style={{ marginTop: 16, fontSize: 13 }}>
                + Add Variable
              </button>

              <div style={{ marginTop: 24, padding: '14px 18px', background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 10, fontSize: 13, color: '#FBBF24' }}>
                💡 You can also add or change env vars later from the project's <strong>Env Variables</strong> tab and redeploy.
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'space-between' }}>
              <button className="lp-btn-secondary" onClick={() => setStep(2)}>← Back</button>
              <button
                className="lp-btn-primary"
                onClick={handleDeploy}
                disabled={creating}
                style={{ minWidth: 200, fontSize: 15 }}
              >
                {creating ? (
                  <span style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
                    <div className="spinner" style={{ width: 16, height: 16, borderTopColor: '#fff', borderWidth: 2 }} />
                    Deploying…
                  </span>
                ) : `🚀 Deploy ${selected?.name}`}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}