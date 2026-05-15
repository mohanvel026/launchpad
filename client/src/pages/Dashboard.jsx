import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

const NAV_TABS = ['Overview', 'Deployments', 'Analytics', 'WAF Security', 'Domains', 'Settings'];

export default function Dashboard() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [activeTab, setActiveTab] = useState('Overview');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!loading && user) api.get('/projects').then(res => setProjects(res.data.projects)).catch(console.error);
  }, [user, loading]);

  const filteredProjects = projects.filter(p => 
    p.name.toLowerCase().includes(search.toLowerCase()) || 
    p.repoFullName.toLowerCase().includes(search.toLowerCase())
  );

  if (loading || !user) return null;

  return (
    <div className="launchpad-container">
      {/* ── Header ── */}
      <header className="lp-header">
        <div className="lp-logo" onClick={() => navigate('/dashboard')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
          </svg>
          LaunchPad
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <img src={user.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--border)' }} />
            <span style={{ fontWeight: 600, fontSize: 14 }}>{user.username}</span>
          </div>
          <button className="lp-btn-secondary" style={{ padding: '8px 16px', fontSize: 13 }} onClick={logout}>Sign Out</button>
        </div>
      </header>

      {/* ── Navigation ── */}
      <div className="lp-nav-container">
        <div className="lp-nav-pills">
          {NAV_TABS.map(tab => (
            <div key={tab} className={`lp-pill ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</div>
          ))}
        </div>
      </div>

      <main className="lp-main" style={{ maxWidth: 1300, margin: '0 auto', padding: '40px' }}>
        {activeTab === 'Overview' && (
          <>
            <div className="flex-between" style={{ marginBottom: '40px', gap: 20, flexWrap: 'wrap' }}>
              <div style={{ position: 'relative', flex: 1, maxWidth: 400 }}>
                <input 
                  type="text" 
                  className="lp-search" 
                  placeholder="Search projects..." 
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ maxWidth: 'none' }}
                />
              </div>
              <button className="lp-btn-primary" onClick={() => navigate('/projects/new')}>Launch New Project</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 48 }}>
              <div className="lp-card glass">
                <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Total Projects</div>
                <div style={{ fontSize: 42, fontWeight: 800 }}>{projects.length}</div>
              </div>
              <div className="lp-card glass">
                <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Active Instances</div>
                <div style={{ fontSize: 42, fontWeight: 800, color: 'var(--accent-primary)' }}>{projects.filter(p => p.status === 'live').length}</div>
              </div>
              <div className="lp-card glass">
                <div style={{ color: 'var(--text-muted)', fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>System Status</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent-success)', boxShadow: '0 0 12px var(--accent-success)' }}></div>
                  <span style={{ fontWeight: 600, color: 'var(--accent-success)' }}>All Nodes Nominal</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))', gap: 24 }}>
              {filteredProjects.length === 0 ? (
                <div className="lp-card flex-center" style={{ gridColumn: '1 / -1', padding: '100px 20px', borderStyle: 'dashed' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 48, marginBottom: 20 }}>🚀</div>
                    <h3>Ready for liftoff?</h3>
                    <p className="text-muted mb-4">Connect your repository and deploy in seconds.</p>
                    <button className="lp-btn-primary" onClick={() => navigate('/projects/new')}>Deploy First App</button>
                  </div>
                </div>
              ) : (
                filteredProjects.map(project => (
                  <div key={project._id} className="lp-card" onClick={() => navigate(`/projects/${project._id}`)} style={{ cursor: 'pointer' }}>
                    <div className="flex-between" style={{ marginBottom: 20 }}>
                      <div style={{ fontSize: 20, fontWeight: 700 }}>{project.name}</div>
                      <div className={`lp-badge ${project.status}`}>{project.status}</div>
                    </div>
                    
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 32 }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-dim)" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                      <span style={{ fontSize: 14, color: 'var(--accent-primary)', fontWeight: 500 }}>
                        {project.subdomain ? `${project.subdomain}.${import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io'}` : 'Awaiting deploy...'}
                      </span>
                    </div>

                    <div className="flex-between" style={{ fontSize: 13, color: 'var(--text-muted)', borderTop: '1px solid var(--border)', paddingTop: 20 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                        {project.repoFullName}
                      </div>
                      <div className="mono">{project.buildCount || 0} Builds</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {activeTab === 'Deployments' && (
          <div className="lp-card" style={{ padding: 0 }}>
            {projects.map((p, i) => (
              <div key={p._id} className="flex-between" style={{ padding: '24px 32px', borderBottom: i === projects.length-1 ? 'none' : '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{p.name} — Production Pipeline</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>Triggered by manual event via dashboard</div>
                </div>
                <button className="lp-btn-secondary" onClick={() => navigate(`/projects/${p._id}`)}>View Pipeline</button>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Domains' && (
          <div className="lp-card">
            <h3>Enterprise Domain Routing</h3>
            <p className="text-muted mb-4">All domains are automatically provisioned with Let's Encrypt TLS certificates and global CDN propagation.</p>
            {projects.map(p => (
              <div key={p._id} className="flex-between glass" style={{ padding: '16px 24px', borderRadius: 10, marginBottom: 12 }}>
                <div style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{p.subdomain}.{import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io'}</div>
                <div style={{ color: 'var(--accent-success)', fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                  TLS SECURED
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Settings' && (
          <div className="lp-card">
            <h3>Workspace Preferences</h3>
            <div style={{ borderTop: '1px solid var(--border)', marginTop: 32, paddingTop: 32 }}>
              <h4>Identity</h4>
              <div className="glass" style={{ padding: 20, borderRadius: 12, display: 'flex', gap: 16, alignItems: 'center' }}>
                <img src={user.avatarUrl} style={{ width: 48, height: 48, borderRadius: '50%' }} />
                <div>
                  <div style={{ fontWeight: 700 }}>{user.username}</div>
                  <div className="text-muted" style={{ fontSize: 13 }}>GitHub Identity Connected</div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}