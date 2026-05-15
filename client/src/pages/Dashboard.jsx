import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

const NAV_TABS = ['Projects', 'Deployments', 'Domains', 'Settings'];

export default function Dashboard() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [activeTab, setActiveTab] = useState('Projects');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!loading && user) {
      api.get('/projects').then(res => setProjects(res.data.projects || [])).catch(console.error);
    }
  }, [user, loading]);

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="loading-spinner" />
    </div>
  );

  if (!user) { navigate('/login'); return null; }

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    p.repoFullName?.toLowerCase().includes(search.toLowerCase())
  );

  const live = projects.filter(p => p.status === 'live').length;

  return (
    <div className="launchpad-container">
      {/* Header */}
      <header className="lp-header">
        <div className="lp-logo">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#38bdf8"/><stop offset="100%" stopColor="#818cf8"/></linearGradient></defs>
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
          </svg>
          LaunchPad
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <img src={user.avatarUrl} alt="" style={{ width: 30, height: 30, borderRadius: '50%', border: '2px solid var(--border-strong)' }} />
          <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-muted)' }}>{user.username}</span>
          <button className="lp-btn-secondary" style={{ padding: '6px 16px', fontSize: 13 }} onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* Nav */}
      <nav className="lp-nav-container">
        <div className="lp-nav-pills">
          {NAV_TABS.map(tab => (
            <div key={tab} className={`lp-pill ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</div>
          ))}
        </div>
      </nav>

      <main className="lp-main" style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        
        {/* Projects Tab */}
        {activeTab === 'Projects' && (
          <div className="fade-in">
            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 32 }}>
              {[
                { label: 'Total Projects', value: projects.length, color: 'var(--text-main)' },
                { label: 'Live Deployments', value: live, color: 'var(--accent-success)' },
                { label: 'Total Builds', value: projects.reduce((a, p) => a + (p.buildCount || 0), 0), color: 'var(--accent-primary)' },
              ].map(stat => (
                <div key={stat.label} className="lp-card" style={{ padding: '20px 24px' }}>
                  <div className="lp-section-label">{stat.label}</div>
                  <div style={{ fontSize: 36, fontWeight: 800, color: stat.color, marginTop: 4 }}>{stat.value}</div>
                </div>
              ))}
            </div>

            {/* Search + New */}
            <div className="flex-between" style={{ marginBottom: 20, gap: 16 }}>
              <input className="lp-search" placeholder="Search projects..." value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 360 }} />
              <button className="lp-btn-primary" onClick={() => navigate('/projects/new')}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                New Project
              </button>
            </div>

            {/* Project Grid */}
            {filtered.length === 0 ? (
              <div className="lp-card flex-center" style={{ padding: '80px 24px', flexDirection: 'column', gap: 16, borderStyle: 'dashed' }}>
                <div style={{ fontSize: 40 }}>🚀</div>
                <h3 style={{ fontWeight: 700 }}>No projects yet</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Connect a repository to start deploying.</p>
                <button className="lp-btn-primary" onClick={() => navigate('/projects/new')}>Deploy First App</button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))', gap: 16 }}>
                {filtered.map(project => (
                  <div key={project._id} className="lp-card lp-card-clickable" onClick={() => navigate(`/projects/${project._id}`)}>
                    <div className="flex-between" style={{ marginBottom: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--gradient-glow)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                          {project.framework === 'next' ? '▲' : project.framework === 'node' ? '🟢' : '⚛️'}
                        </div>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{project.name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{project.repoFullName}</div>
                        </div>
                      </div>
                      <span className={`lp-badge ${project.status || 'idle'}`}>{project.status || 'idle'}</span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, marginBottom: 16 }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                      <span style={{ fontSize: 12, color: 'var(--accent-primary)', fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {project.subdomain ? `${project.subdomain}.${import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io'}` : 'No domain assigned'}
                      </span>
                    </div>

                    <div className="flex-between" style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                      <span>Branch: <span style={{ color: 'var(--text-muted)' }}>{project.branch || 'main'}</span></span>
                      <span>{project.buildCount || 0} builds</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Deployments Tab */}
        {activeTab === 'Deployments' && (
          <div className="fade-in lp-card" style={{ padding: 0 }}>
            <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 16 }}>All Deployments</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>Deployment activity across all your projects.</p>
            </div>
            {projects.length === 0 ? (
              <div className="flex-center" style={{ padding: 60, color: 'var(--text-muted)', fontSize: 14 }}>No deployments yet</div>
            ) : (
              <table className="lp-table">
                <thead>
                  <tr>
                    <th>Project</th>
                    <th>Status</th>
                    <th>Branch</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr key={p._id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td><span className={`lp-badge ${p.status || 'idle'}`}>{p.status || 'idle'}</span></td>
                      <td><span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.branch}</span></td>
                      <td><button className="lp-btn-secondary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => navigate(`/projects/${p._id}`)}>View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Domains Tab */}
        {activeTab === 'Domains' && (
          <div className="fade-in">
            <div className="lp-card" style={{ marginBottom: 16, padding: '20px 24px' }}>
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>Domain Management</h3>
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>All domains are automatically provisioned with TLS certificates.</p>
            </div>
            {projects.filter(p => p.subdomain).map(p => (
              <div key={p._id} className="lp-card flex-between" style={{ marginBottom: 12, padding: '16px 24px' }}>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: 4, fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--accent-primary)' }}>
                    {p.subdomain}.{import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.name}</div>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className="lp-badge success">TLS Active</span>
                  <button className="lp-btn-secondary" style={{ padding: '5px 14px', fontSize: 12 }} onClick={() => navigate(`/projects/${p._id}`)}>Manage</button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Settings Tab */}
        {activeTab === 'Settings' && (
          <div className="fade-in" style={{ maxWidth: 600 }}>
            <div className="lp-card" style={{ padding: 28 }}>
              <h3 style={{ marginBottom: 24 }}>Account</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: 20, background: 'rgba(255,255,255,0.02)', borderRadius: 10, border: '1px solid var(--border)' }}>
                <img src={user.avatarUrl} style={{ width: 52, height: 52, borderRadius: '50%', border: '2px solid var(--border-strong)' }} alt="" />
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{user.username}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>GitHub account connected</div>
                </div>
              </div>
              <hr className="lp-divider" />
              <button className="lp-btn-danger" onClick={logout}>Sign Out</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}