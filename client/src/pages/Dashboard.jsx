import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';
import NotificationCenter from '../components/NotificationCenter';
import CommandPalette from '../components/CommandPalette';

const NAV_TABS = ['Projects', 'Deployments', 'Domains', 'Activity', 'Settings'];

const STACK_ICONS = {
  next: '▲', nuxt: '💚', react: '⚛️', node: '🟢', mern: '🏗️',
  vue: '💚', static: '📄', fullstack: '🏗️', unknown: '📦'
};

export default function Dashboard() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
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
  const [activeTab, setActiveTab] = useState('Projects');
  const [search, setSearch] = useState('');
  const [recentActivity, setRecentActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    if (!loading && user) {
      api.get('/projects').then(res => setProjects(res.data.projects || [])).catch(console.error);
    }
  }, [user, loading]);

  useEffect(() => {
    if (loading || !user) return;
    const socketUrl = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';
    const socket = io(socketUrl, {
      transports: ['websocket', 'polling']
    });

    socket.on('dashboard-update', () => {
      api.get('/projects').then(res => setProjects(res.data.projects || [])).catch(console.error);
    });

    return () => {
      socket.disconnect();
    };
  }, [user, loading]);

  const loadActivity = async () => {
    setActivityLoading(true);
    try {
      const res = await api.get('/deploy/recent-activity');
      const mapped = (res.data.deployments || []).map(d => ({
        ...d,
        projectId: d.project?._id,
        projectName: d.project?.name
      }));
      setRecentActivity(mapped);
    } catch (e) {
      console.error(e);
    } finally {
      setActivityLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'Activity' && recentActivity.length === 0) {
      setTimeout(() => {
        loadActivity();
      }, 0);
    }
  }, [activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

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
    <div className="launchlive-container">
      {/* Header */}
      <header className="lp-header">
        <div className="lp-page lp-header-inner">
          <div className="lp-logo">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="url(#grad)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <defs><linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#38bdf8"/><stop offset="100%" stopColor="#818cf8"/></linearGradient></defs>
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
            </svg>
            LaunchLive
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setIsPaletteOpen(true)}
              className="lp-btn-secondary"
              style={{ padding: '6px 12px', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}
            >
              🔍 Search... <kbd style={{ background: 'rgba(255,255,255,0.08)', padding: '2px 4px', borderRadius: 3, fontSize: 10, fontFamily: 'var(--font-mono)' }}>Ctrl+K</kbd>
            </button>
            <NotificationCenter user={user} />
            <img src={user.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--border-strong)' }} />
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-muted)' }}>{user.username}</span>
            <button className="lp-btn-secondary" style={{ padding: '6px 16px', fontSize: 13 }} onClick={logout}>Sign Out</button>
          </div>
        </div>
      </header>

      {/* Nav */}
      <nav className="lp-nav-container">
        <div className="lp-page lp-nav-pills">
          {NAV_TABS.map(tab => (
            <div key={tab} className={`lp-pill ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</div>
          ))}
        </div>
      </nav>

      <main className="lp-main">
        <div className="lp-page">
        
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
            {projects.length === 0 ? (
              <div className="lp-card glass" style={{
                padding: '48px 40px',
                textAlign: 'center',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 24,
                border: '1px solid var(--border)',
                background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.05) 0%, rgba(129, 140, 248, 0.03) 100%)',
                borderRadius: 20,
                maxWidth: 600,
                margin: '40px auto 0'
              }}>
                <div style={{
                  width: 64, height: 64, borderRadius: 16,
                  background: 'var(--gradient-glow)',
                  border: '1px solid var(--border)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 28, color: 'var(--accent-primary)',
                  boxShadow: '0 0 30px rgba(56, 189, 248, 0.15)',
                  marginBottom: 8
                }}>
                  🚀
                </div>
                <div>
                  <h2 style={{ fontSize: 22, fontWeight: 800, marginBottom: 8, letterSpacing: '-0.02em' }}>Welcome to LaunchLive!</h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: 14, lineHeight: 1.6, maxWidth: 460 }}>
                    Your next-gen developer platform is ready. Connect a GitHub repository to automatically build, secure, and deploy your web applications with SRE health monitoring.
                  </p>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  margin: '8px 0'
                }}>
                  {[
                    { step: '1', title: 'Connect GitHub', desc: 'Authorize and list repositories' },
                    { step: '2', title: 'Auto Stack Detect', desc: 'Framework & env vars auto-discovered' },
                    { step: '3', title: 'Push to Deploy', desc: 'Automatic builds on every commit' }
                  ].map(s => (
                    <div key={s.step} style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)', borderRadius: 12, padding: 16 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ width: 20, height: 20, borderRadius: '50%', background: 'rgba(56, 189, 248, 0.1)', color: 'var(--accent-primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700 }}>
                          {s.step}
                        </span>
                        <span style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-main)' }}>{s.title}</span>
                      </div>
                      <p style={{ color: 'var(--text-dim)', fontSize: 11, lineHeight: 1.4 }}>{s.desc}</p>
                    </div>
                  ))}
                </div>

                <button className="lp-btn-primary" onClick={() => navigate('/projects/new')} style={{ padding: '10px 24px', fontSize: 14 }}>
                  Deploy Your First Project →
                </button>
              </div>
            ) : filtered.length === 0 ? (
              <div className="lp-card flex-center" style={{ padding: '80px 24px', flexDirection: 'column', gap: 16, borderStyle: 'dashed' }}>
                <div style={{ fontSize: 40 }}>🚀</div>
                <h3 style={{ fontWeight: 700 }}>No projects found</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Try searching with a different term.</p>
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
                        <span className={`lp-badge ${project.status || 'idle'} ${project.status === 'building' ? 'animate-pulse-gold' : ''}`}>{project.status || 'idle'}</span>
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
                          {(project.customDomain && (project.customDomainStatus === 'active' || project.customDomainStatus === 'dns_verified'))
                            ? project.customDomain
                            : (project.subdomain ? `${project.subdomain}.${import.meta.env.VITE_DOMAIN || 'launchlive.in'}` : 'No domain assigned')}
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
                    {p.subdomain}.{import.meta.env.VITE_DOMAIN || 'launchlive.in'}
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

        {/* Activity Tab */}
        {activeTab === 'Activity' && (
          <div className="fade-in">
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <div>
                <h3 style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Recent Deployments</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Activity across all your projects</p>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.2)',
                  borderRadius: 99, padding: '5px 12px', fontSize: 12, fontWeight: 700, color: '#34d399',
                }}>
                  <div style={{
                    width: 7, height: 7, borderRadius: '50%', background: '#10b981',
                    animation: 'pulse-dot 2s infinite',
                  }} />
                  Live
                </div>
                <button
                  className="lp-btn-secondary"
                  style={{ padding: '6px 14px', fontSize: 12 }}
                  onClick={() => loadActivity()}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/>
                  </svg>
                  Refresh
                </button>
              </div>
            </div>

            {/* Feed */}
            {activityLoading ? (
              <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', padding: '80px 0', gap: 12, color: 'var(--text-muted)', fontSize: 14 }}>
                <div className="loading-spinner" />
                Loading deployments…
              </div>
            ) : recentActivity.length === 0 ? (
              <div className="lp-card flex-center" style={{ padding: '80px 24px', flexDirection: 'column', gap: 16, borderStyle: 'dashed' }}>
                <div style={{ fontSize: 40 }}>📭</div>
                <h3 style={{ fontWeight: 700 }}>No deployments yet</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Deploy your first project to see activity here.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {recentActivity.map((dep, i) => {
                  const statusColor = dep.status === 'success' ? '#34d399'
                    : dep.status === 'failed' ? '#f87171'
                    : dep.status === 'building' ? '#fbbf24'
                    : '#94a3b8';
                  const statusBg = dep.status === 'success' ? 'rgba(52,211,153,0.08)'
                    : dep.status === 'failed' ? 'rgba(248,113,113,0.08)'
                    : dep.status === 'building' ? 'rgba(251,191,36,0.08)'
                    : 'rgba(148,163,184,0.08)';
                  const statusBorder = dep.status === 'success' ? 'rgba(52,211,153,0.2)'
                    : dep.status === 'failed' ? 'rgba(248,113,113,0.2)'
                    : dep.status === 'building' ? 'rgba(251,191,36,0.2)'
                    : 'rgba(148,163,184,0.15)';

                  const now = Date.now(); // eslint-disable-line react-hooks/purity
                  const created = new Date(dep.createdAt).getTime();
                  const diffMs = now - created;
                  const diffMin = Math.floor(diffMs / 60000);
                  const diffHr  = Math.floor(diffMin / 60);
                  const diffDay = Math.floor(diffHr / 24);
                  const timeAgo = diffDay > 0 ? `${diffDay}d ago`
                    : diffHr > 0  ? `${diffHr}h ago`
                    : diffMin > 0 ? `${diffMin}m ago`
                    : 'just now';

                  return (
                    <div
                      key={dep._id || i}
                      className="lp-card"
                      style={{
                        padding: '16px 20px',
                        display: 'flex', alignItems: 'center', gap: 16,
                        cursor: 'pointer', transition: 'border-color 0.2s, box-shadow 0.2s, transform 0.2s',
                        animation: `fade-in-up 0.3s ease ${i * 0.04}s both`,
                      }}
                      onClick={() => navigate(`/projects/${dep.projectId}`)}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(56,189,248,0.25)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; }}
                    >
                      {/* Status dot */}
                      <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: statusBg, border: `1px solid ${statusBorder}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {dep.status === 'success' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                        )}
                        {dep.status === 'failed' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                        )}
                        {dep.status === 'building' && (
                          <div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2, borderTopColor: statusColor }} />
                        )}
                        {dep.status === 'queued' && (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={statusColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        )}
                      </div>

                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                          <span style={{
                            padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                            background: 'rgba(56,189,248,0.08)', color: '#38bdf8',
                            border: '1px solid rgba(56,189,248,0.15)',
                          }}>
                            {dep.project?.name || dep.projectName}
                          </span>
                          {dep.project && (dep.project.subdomain || dep.project.customDomain) && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const liveUrl = dep.project.customDomain 
                                  ? `https://${dep.project.customDomain}` 
                                  : `https://${dep.project.subdomain}.${import.meta.env.VITE_DOMAIN || 'launchlive.in'}`;
                                navigator.clipboard.writeText(liveUrl);
                                setCopiedId(dep._id);
                                setTimeout(() => setCopiedId(null), 2000);
                              }}
                              style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                padding: 4, color: 'var(--text-dim)', borderRadius: 4, transition: 'all 0.2s'
                              }}
                              onMouseEnter={e => { e.currentTarget.style.color = 'var(--accent-primary)'; e.currentTarget.style.background = 'rgba(56,189,248,0.08)'; }}
                              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-dim)'; e.currentTarget.style.background = 'none'; }}
                              title="Copy Live URL"
                            >
                              {copiedId === dep._id ? (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="20 6 9 17 4 12"/>
                                </svg>
                              ) : (
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                              )}
                            </button>
                          )}
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: 4 }}>
                            {dep.branch || 'main'}
                          </span>
                          {dep.commitSha && (
                            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-dim)' }}>
                              {dep.commitSha.slice(0, 7)}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-main)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {dep.commitMessage || 'No commit message'}
                        </div>
                      </div>

                      {/* Right side */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6, flexShrink: 0 }}>
                        <span
                          className={`lp-badge ${dep.status === 'success' ? 'success' : dep.status === 'failed' ? 'failed' : dep.status === 'building' ? 'building' : 'idle'} ${dep.status === 'building' ? 'animate-pulse-gold' : ''}`}
                        >
                          {dep.status}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{timeAgo}</span>
                        {dep.duration && dep.status === 'success' && (
                          <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>{Math.round(dep.duration / 1000)}s</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
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
        </div>{/* /lp-page */}
      </main>
      <CommandPalette
        isOpen={isPaletteOpen}
        onClose={() => setIsPaletteOpen(false)}
      />
    </div>
  );
}