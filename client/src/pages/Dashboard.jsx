import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import api from '../lib/api';

const STATUS_COLOR = {
  live:     { bg: '#f0fdf4', text: '#166534', dot: '#22c55e' },
  building: { bg: '#fffbeb', text: '#92400e', dot: '#f59e0b' },
  failed:   { bg: '#fff1f2', text: '#9f1239', dot: '#f43f5e' },
  idle:     { bg: '#f8fafc', text: '#475569', dot: '#94a3b8' },
  stopped:  { bg: '#f8fafc', text: '#475569', dot: '#94a3b8' },
};

function StatusBadge({ status }) {
  const c = STATUS_COLOR[status] || STATUS_COLOR.idle;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', padding: '3px 10px', borderRadius: '100px', background: c.bg, color: c.text, fontSize: '12px', fontWeight: '500' }}>
      <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: c.dot, display: 'inline-block' }} />
      {status}
    </span>
  );
}

export default function Dashboard() {
  const { user, loading, logout } = useAuth();
  const navigate  = useNavigate();
  const [projects, setProjects] = useState([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && user) {
      api.get('/projects')
        .then((res) => setProjects(res.data.projects))
        .catch(console.error)
        .finally(() => setFetching(false));
    }
  }, [user, loading]);

  if (loading) return <div style={{ padding: '2rem' }}>Loading…</div>;
  if (!user)   { window.location.href = '/login'; return null; }

  const s = { fontFamily: 'system-ui, sans-serif', maxWidth: '960px', margin: '0 auto', padding: '2rem' };

  return (
    <div style={s}>
      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <img src={user.avatarUrl} alt={user.username} style={{ width: '36px', height: '36px', borderRadius: '50%' }} />
          <div>
            <div style={{ fontWeight: '600', fontSize: '15px' }}>{user.username}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>{user.plan} plan · {projects.length}/{user.appLimit} apps</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => navigate('/projects/new')}
            style={{ padding: '8px 18px', background: '#0070f3', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>
            + New Project
          </button>
          <button onClick={logout}
            style={{ padding: '8px 14px', background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px' }}>
            Logout
          </button>
        </div>
      </div>

      {/* ── Projects Grid ── */}
      <h2 style={{ fontSize: '16px', fontWeight: '600', marginBottom: '1rem' }}>Projects</h2>

      {fetching ? (
        <p style={{ color: '#888' }}>Loading projects…</p>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '4rem 2rem', border: '1px dashed #e2e8f0', borderRadius: '12px', color: '#94a3b8' }}>
          <div style={{ fontSize: '32px', marginBottom: '8px' }}>🚀</div>
          <div style={{ fontWeight: '500', marginBottom: '4px' }}>No projects yet</div>
          <div style={{ fontSize: '13px' }}>Click <strong>+ New Project</strong> to deploy your first app</div>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '14px' }}>
          {projects.map((project) => (
            <div key={project._id}
              onClick={() => navigate(`/projects/${project._id}`)}
              style={{ border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.1rem 1.2rem', cursor: 'pointer', background: '#fff', transition: 'border-color 0.15s' }}
              onMouseEnter={(e) => e.currentTarget.style.borderColor = '#93c5fd'}
              onMouseLeave={(e) => e.currentTarget.style.borderColor = '#e2e8f0'}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ fontWeight: '600', fontSize: '14px' }}>{project.name}</div>
                <StatusBadge status={project.status} />
              </div>
              <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
                {project.repoFullName} · {project.branch}
              </div>
              {project.subdomain && (
                <a href={`https://${project.subdomain}.${import.meta.env.VITE_DOMAIN || 'launchpad.dev'}`}
                  target="_blank" rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  style={{ fontSize: '12px', color: '#0070f3', textDecoration: 'none' }}>
                  {project.subdomain}.{import.meta.env.VITE_DOMAIN || 'launchpad.dev'} ↗
                </a>
              )}
              <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '8px' }}>
                {project.stack && <span style={{ marginRight: '8px' }}>Stack: {project.stack}</span>}
                Deploys: {project.buildCount}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}