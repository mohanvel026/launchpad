import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function TeamManager({ project, currentUser }) {
  const [team,     setTeam]     = useState({ owner: null, collaborators: [] });
  const [username, setUsername] = useState('');
  const [loading,  setLoading]  = useState(false);
  const [message,  setMessage]  = useState('');
  const [error,    setError]    = useState('');

  const isOwner = project.owner?._id === currentUser?._id ||
                  project.owner === currentUser?._id;

  useEffect(() => {
    api.get(`/team/${project._id}`).then((r) => setTeam(r.data)).catch(() => {});
  }, [project._id]);

  const handleInvite = async () => {
    if (!username.trim()) return;
    setLoading(true); setError(''); setMessage('');
    try {
      const res = await api.post(`/team/${project._id}/invite`, { username: username.trim() });
      setMessage(res.data.message);
      setTeam((prev) => ({ ...prev, collaborators: [...prev.collaborators, res.data.collaborator] }));
      setUsername('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to invite');
    } finally { setLoading(false); }
  };

  const handleRemove = async (userId) => {
    if (!window.confirm('Remove this collaborator?')) return;
    try {
      await api.delete(`/team/${project._id}/remove/${userId}`);
      setTeam((prev) => ({ ...prev, collaborators: prev.collaborators.filter((c) => c._id !== userId) }));
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove');
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32 }}>
      <div className="lp-card glass" style={{ padding: 32 }}>
        <h3 style={{ margin: '0 0 24px' }}>Project Permissions</h3>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {team.owner && (
            <div className="flex-between glass" style={{ padding: '16px 24px', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <img src={team.owner.avatarUrl} style={{ width: 40, height: 40, borderRadius: '50%' }} />
                <div>
                  <div style={{ fontWeight: 700 }}>{team.owner.username}</div>
                  <div style={{ fontSize: 12, color: 'var(--accent-success)', fontWeight: 700 }}>PROJECT OWNER</div>
                </div>
              </div>
            </div>
          )}

          {team.collaborators.map(c => (
            <div key={c._id} className="flex-between glass" style={{ padding: '16px 24px', borderRadius: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <img src={c.avatarUrl} style={{ width: 40, height: 40, borderRadius: '50%' }} />
                <div>
                  <div style={{ fontWeight: 600 }}>{c.username}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>Collaborator</div>
                </div>
              </div>
              {isOwner && (
                <button onClick={() => handleRemove(c._id)} style={{ background: 'none', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Remove</button>
              )}
            </div>
          ))}

          {team.collaborators.length === 0 && (
            <p className="text-muted" style={{ textAlign: 'center', padding: '20px 0' }}>No external collaborators assigned.</p>
          )}
        </div>
      </div>

      {isOwner && (
        <div className="lp-card glass" style={{ padding: 32 }}>
          <h3 style={{ margin: '0 0 12px' }}>Invite Team Members</h3>
          <p className="text-muted mb-4">Grant access to this project using their GitHub identity.</p>
          <div style={{ display: 'flex', gap: 12 }}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter GitHub handle..."
              className="lp-search"
              style={{ flex: 1, backgroundImage: 'none', paddingLeft: 16 }}
            />
            <button onClick={handleInvite} disabled={loading} className="lp-btn-primary" style={{ padding: '0 24px' }}>
              {loading ? '...' : 'Send Invite'}
            </button>
          </div>
        </div>
      )}

      {message && <div className="glass" style={{ padding: 12, borderRadius: 10, color: 'var(--accent-success)', fontSize: 13, border: '1px solid rgba(52, 211, 153, 0.2)' }}>{message}</div>}
      {error && <div className="glass" style={{ padding: 12, borderRadius: 10, color: 'var(--accent-danger)', fontSize: 13, border: '1px solid rgba(248, 113, 113, 0.2)' }}>{error}</div>}
    </div>
  );
}