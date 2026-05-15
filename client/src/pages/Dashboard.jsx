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

  useEffect(() => {
    if (!loading && user) api.get('/projects').then(res => setProjects(res.data.projects)).catch(console.error);
  }, [user, loading]);

  if (loading || !user) return null;

  return (
    <div className="launchpad-container">
      <header className="lp-header">
        <div className="lp-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/dashboard')}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#gradient)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <defs><linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#06B6D4" /><stop offset="100%" stopColor="#8B5CF6" /></linearGradient></defs>
            <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
            <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
            <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"></path><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"></path>
          </svg>
          LaunchPad
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
            <img src={user.avatarUrl} alt="" style={{ width: 32, height: 32, borderRadius: '50%', border: '2px solid var(--border)' }} />
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>{user.username}</span>
          </div>
          <button className="lp-btn-secondary" onClick={logout}>Sign Out</button>
        </div>
      </header>

      <div className="lp-nav-container">
        <div className="lp-nav-pills">
          {NAV_TABS.map(tab => (
            <div key={tab} className={`lp-pill ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>{tab}</div>
          ))}
        </div>
      </div>

      <main className="lp-main">
        {activeTab === 'Overview' && (
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <input type="text" className="lp-search" placeholder="Search your projects..." />
              <button className="lp-btn-primary" onClick={() => navigate('/projects/new')}>+ Launch New Project</button>
            </div>
            <div className="lp-stats-grid">
              <div className="lp-stat-card">
                <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Active Projects</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--text-main)' }}>{projects.length}</div>
              </div>
              <div className="lp-stat-card">
                <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>Global Edge CDN</div>
                <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--accent-cyan)' }}>Enabled</div>
              </div>
              <div className="lp-stat-card">
                <div style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, textTransform: 'uppercase', marginBottom: 8 }}>System Health</div>
                <div style={{ fontSize: 24, fontWeight: 700, color: '#34D399', display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#34D399', boxShadow: '0 0 12px #34D399' }}></div> All Systems Nominal
                </div>
              </div>
            </div>
            <div className="lp-projects-grid">
              {projects.length === 0 ? (
                <div className="lp-empty" style={{ gridColumn: '1 / -1' }}>
                  <div className="lp-empty-icon">🚀</div>
                  <h3 style={{ fontSize: 24, margin: '0 0 16px 0' }}>Ready for liftoff?</h3>
                  <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Connect your GitHub repository and deploy in seconds.</p>
                  <button className="lp-btn-primary" onClick={() => navigate('/projects/new')}>Deploy First Project</button>
                </div>
              ) : (
                projects.map(project => (
                  <div key={project._id} className="lp-card" onClick={() => navigate(`/projects/${project._id}`)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                      <div className="lp-card-title">{project.name}</div>
                      <div className={`lp-badge ${project.status}`}>{project.status}</div>
                    </div>
                    <a href={project.subdomain ? `http://${project.subdomain}.${import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io'}` : '#'} onClick={e => e.stopPropagation()} target="_blank" rel="noreferrer" className="lp-card-link">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                      {project.subdomain ? `${project.subdomain}.${import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io'}` : 'Awaiting Deployment'}
                    </a>
                    <div className="lp-card-footer">
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path></svg>
                        {project.repoFullName}
                      </div>
                      <div>{project.buildCount} Deploys</div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </>
        )}

        {activeTab === 'Deployments' && (
          <div>
            <h2 style={{ fontSize: 28, marginBottom: 24 }}>Recent Deployments</h2>
            <div className="lp-card" style={{ padding: 0 }}>
              {projects.length === 0 && <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>No deployments available.</div>}
              {projects.map((p, i) => (
                <div key={p._id} style={{ display: 'flex', justifyContent: 'space-between', padding: '20px 24px', borderBottom: i === projects.length-1 ? 'none' : '1px solid var(--border)' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-main)', marginBottom: 4 }}>{p.name} - Production Build</div>
                    <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Triggered by {user.username}</div>
                  </div>
                  <button className="lp-btn-secondary" onClick={() => navigate(`/projects/${p._id}`)}>View Console Logs</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Analytics' && (
          <div>
            <h2 style={{ fontSize: 28, marginBottom: 24 }}>Global Traffic Analytics</h2>
            <div className="lp-card" style={{ height: 400, display: 'flex', alignItems: 'flex-end', gap: 16, padding: '40px 24px' }}>
              {[40, 60, 30, 80, 50, 90, 70, 85, 45, 100].map((h, i) => (
                <div key={i} style={{ flex: 1, height: `${h}%`, background: 'var(--accent-gradient)', borderRadius: '8px 8px 0 0', opacity: 0.8, transition: 'opacity 0.2s', cursor: 'pointer' }} onMouseEnter={e => e.target.style.opacity=1} onMouseLeave={e => e.target.style.opacity=0.8}></div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'WAF Security' && (
          <div>
            <h2 style={{ fontSize: 28, marginBottom: 24 }}>Web Application Firewall</h2>
            <div className="lp-card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>DDoS Mitigation Shield</div>
                  <div style={{ color: 'var(--text-muted)' }}>Automatically dropping malformed L3/L4 packets before they hit your containers.</div>
                </div>
                <div style={{ background: 'rgba(6, 182, 212, 0.1)', color: 'var(--accent-cyan)', padding: '8px 16px', borderRadius: 24, fontWeight: 700, fontSize: 14 }}>ACTIVE</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-main)', marginBottom: 4 }}>GeoIP Blocking Rules</div>
                  <div style={{ color: 'var(--text-muted)' }}>Restrict access from specific countries or IP ranges.</div>
                </div>
                <button className="lp-btn-secondary">Configure Rules</button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Domains' && (
          <div>
            <h2 style={{ fontSize: 28, marginBottom: 24 }}>Automated SSL Domains</h2>
            <div className="lp-card">
              <p style={{ color: 'var(--text-muted)', marginBottom: 24 }}>Your projects are automatically secured using Let's Encrypt and wildcard routing.</p>
              {projects.length === 0 && <div style={{ color: 'var(--text-muted)' }}>Deploy a project to assign a domain.</div>}
              {projects.map(p => (
                <div key={p._id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderTop: '1px solid var(--border)' }}>
                  <div style={{ color: 'var(--accent-cyan)', fontWeight: 600, fontSize: 16 }}>{p.subdomain}.{import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io'}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#34D399', fontWeight: 600, fontSize: 14 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    Valid SSL Certificate
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Settings' && (
          <div className="lp-card">
            <h2 style={{ fontSize: 28, marginBottom: 24 }}>Workspace Settings</h2>
            
            <div style={{ marginBottom: 32 }}>
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>GitHub Integration</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Your account is connected to GitHub. All pushes to your main branches will automatically trigger a new deployment.</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,255,255,0.02)', padding: '16px', borderRadius: 8, border: '1px solid var(--border)' }}>
                <img src={user.avatarUrl} alt="" style={{ width: 40, height: 40, borderRadius: '50%' }} />
                <div>
                  <div style={{ fontWeight: 600 }}>{user.username}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Connected via GitHub OAuth</div>
                </div>
              </div>
            </div>

            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 32 }}>
              <h3 style={{ fontSize: 18, marginBottom: 8 }}>Delete Account</h3>
              <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>Permanently delete your account and all associated projects and deployments. This action cannot be undone.</p>
              <button className="lp-btn-secondary" style={{ borderColor: 'rgba(239, 68, 68, 0.5)', color: '#F87171' }}>Delete Account</button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}