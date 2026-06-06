import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

const NAV_TABS = ['Projects', 'Deployments', 'Domains', 'Settings'];

const STACK_ICONS = {
  next: '▲', nuxt: '💚', react: '⚛️', node: '🟢', mern: '🏗️',
  vue: '💚', static: '📄', fullstack: '🏗️', unknown: '📦'
};

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
  const failed = projects.filter(p => p.status === 'failed').length;
  const totalBuilds = projects.reduce((a, p) => a + (p.buildCount || 0), 0);
  const totalCriticalCVEs = projects.reduce((a, p) => a + (p.vulnSummary?.critical || 0), 0);
  const totalHighCVEs = projects.reduce((a, p) => a + (p.vulnSummary?.high || 0), 0);
  const unhealthyProjects = projects.filter(p => (p.lastHealthScore || 100) < 70).length;
  const avgHealthScore = projects.length
    ? Math.round(projects.reduce((a, p) => a + (p.lastHealthScore || 100), 0) / projects.length)
    : 100;

  return (
    <div className="launchpad-container">
      {/* Header */}
      <header className="lp-header" style={{ display: 'block', padding: 0 }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', height: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 40px' }}>
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
            {/* Global Stats Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 16, marginBottom: 32 }}>
              {[
                { label: 'Total Projects', value: projects.length, color: 'var(--text-main)', icon: '📦' },
                { label: 'Live Deployments', value: live, color: 'var(--accent-success)', icon: '🚀' },
                { label: 'Total Builds', value: totalBuilds, color: 'var(--accent-primary)', icon: '🔨' },
                { label: 'Avg Health Score', value: `${avgHealthScore}%`, color: avgHealthScore >= 80 ? '#34d399' : avgHealthScore >= 50 ? '#fbbf24' : '#f87171', icon: avgHealthScore >= 80 ? '🟢' : avgHealthScore >= 50 ? '🟡' : '🔴' },
                { label: 'Critical CVEs', value: totalCriticalCVEs + totalHighCVEs, color: totalCriticalCVEs > 0 ? '#f87171' : '#34d399', icon: totalCriticalCVEs > 0 ? '🛡️' : '✅' },
                { label: 'Unhealthy Apps', value: unhealthyProjects, color: unhealthyProjects > 0 ? '#fbbf24' : '#34d399', icon: unhealthyProjects > 0 ? '⚠️' : '✅' },
              ].map(stat => (
                <div key={stat.label} className="lp-card" style={{ padding: '18px 20px' }}>
                  <div className="lp-section-label" style={{ fontSize: 10, marginBottom: 4 }}>{stat.label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <span style={{ fontSize: 18 }}>{stat.icon}</span>
                    <span style={{ fontSize: 28, fontWeight: 800, color: stat.color }}>{stat.value}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Global alerts banner */}
            {(totalCriticalCVEs > 0 || unhealthyProjects > 0 || failed > 0) && (
              <div style={{
                padding: '14px 20px', borderRadius: 12, marginBottom: 24,
                background: 'linear-gradient(135deg, rgba(248,113,113,0.07) 0%, rgba(251,191,36,0.05) 100%)',
                border: '1px solid rgba(248,113,113,0.2)',
                display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'center', fontSize: 13
              }}>
                <span style={{ fontWeight: 700, color: '#f87171', display: 'flex', alignItems: 'center', gap: 6 }}>
                  ⚡ System Alerts
                </span>
                {totalCriticalCVEs > 0 && <span style={{ color: '#f87171' }}>🛡️ {totalCriticalCVEs} critical CVE{totalCriticalCVEs !== 1 ? 's' : ''} need patching</span>}
                {unhealthyProjects > 0 && <span style={{ color: '#fbbf24' }}>⚠️ {unhealthyProjects} unhealthy app{unhealthyProjects !== 1 ? 's' : ''} detected</span>}
                {failed > 0 && <span style={{ color: '#fb923c' }}>❌ {failed} failed deployment{failed !== 1 ? 's' : ''}</span>}
              </div>
            )}

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
                {filtered.map(project => {
                  const health = project.lastHealthScore ?? 100;
                  const hasCritical = (project.vulnSummary?.critical || 0) > 0;
                  const hasHigh = (project.vulnSummary?.high || 0) > 0;
                  return (
                    <div key={project._id} className="lp-card lp-card-clickable" onClick={() => navigate(`/projects/${project._id}`)}>
                      <div className="flex-between" style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--gradient-glow)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>
                            {STACK_ICONS[project.stack] || STACK_ICONS[project.framework] || '📦'}
                          </div>
                          <div>
                            <div style={{ fontWeight: 700, fontSize: 15 }}>{project.name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 2 }}>{project.repoFullName}</div>
                          </div>
                        </div>
                        <span className={`lp-badge ${project.status || 'idle'}`}>{project.status || 'idle'}</span>
                      </div>

                      {/* Status indicators row */}
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                        {/* Health badge */}
                        <span style={{
                          padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                          background: health >= 80 ? 'rgba(52,211,153,0.1)' : health >= 50 ? 'rgba(251,191,36,0.1)' : 'rgba(248,113,113,0.1)',
                          color: health >= 80 ? '#34d399' : health >= 50 ? '#fbbf24' : '#f87171',
                          border: `1px solid ${health >= 80 ? 'rgba(52,211,153,0.2)' : health >= 50 ? 'rgba(251,191,36,0.2)' : 'rgba(248,113,113,0.2)'}`,
                        }}>
                          {health >= 80 ? '🟢' : health >= 50 ? '🟡' : '🔴'} {health}% health
                        </span>

                        {/* CVE badge */}
                        {(hasCritical || hasHigh) && (
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: 'rgba(248,113,113,0.1)', color: '#f87171',
                            border: '1px solid rgba(248,113,113,0.2)',
                          }}>
                            ⚠️ {(project.vulnSummary?.critical || 0) + (project.vulnSummary?.high || 0)} CVEs
                          </span>
                        )}

                        {/* Active previews */}
                        {(project.previews?.filter(p => p.status === 'live')?.length || 0) > 0 && (
                          <span style={{
                            padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 600,
                            background: 'rgba(56,189,248,0.1)', color: '#38bdf8',
                            border: '1px solid rgba(56,189,248,0.2)',
                          }}>
                            🔍 {project.previews?.filter(p => p.status === 'live')?.length || 0} previews
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'rgba(255,255,255,0.02)', borderRadius: 6, marginBottom: 12 }}>
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
                  );
                })}
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
                    <th>Health</th>
                    <th>Branch</th>
                    <th>Builds</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map(p => (
                    <tr key={p._id}>
                      <td style={{ fontWeight: 600 }}>{p.name}</td>
                      <td><span className={`lp-badge ${p.status || 'idle'}`}>{p.status || 'idle'}</span></td>
                      <td>
                        <span style={{
                          fontSize: 12, fontWeight: 600,
                          color: (p.lastHealthScore || 100) >= 80 ? '#34d399' : (p.lastHealthScore || 100) >= 50 ? '#fbbf24' : '#f87171'
                        }}>
                          {p.lastHealthScore || 100}%
                        </span>
                      </td>
                      <td><span className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.branch}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 13 }}>{p.buildCount || 0}</td>
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
                  {p.customDomain && (
                    <div style={{ fontSize: 12, color: '#818cf8', marginTop: 2 }}>
                      Custom: {p.customDomain} — <span style={{ color: p.customDomainStatus === 'active' ? '#34d399' : '#fbbf24' }}>{p.customDomainStatus}</span>
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className={`lp-badge ${p.sslStatus === 'active' ? 'success' : 'idle'}`}>
                    {p.sslStatus === 'active' ? 'TLS Active' : 'TLS Pending'}
                  </span>
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