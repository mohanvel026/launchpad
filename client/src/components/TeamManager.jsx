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
    api.get(`/team/${project._id}`)
      .then((r) => setTeam(r.data))
      .catch(() => {});
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

  const s = { fontFamily: 'system-ui, sans-serif' };

  return (
    <div style={s}>
      {/* Owner */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '12px', fontWeight: '500', color: '#64748b', marginBottom: '8px', letterSpacing: '0.05em' }}>OWNER</div>
        {team.owner && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src={team.owner.avatarUrl} alt={team.owner.username}
              style={{ width: '32px', height: '32px', borderRadius: '50%' }} />
            <span style={{ fontSize: '14px', fontWeight: '500' }}>{team.owner.username}</span>
            <span style={{ fontSize: '11px', background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: '100px' }}>Owner</span>
          </div>
        )}
      </div>

      {/* Collaborators */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '12px', fontWeight: '500', color: '#64748b', marginBottom: '8px', letterSpacing: '0.05em' }}>
          COLLABORATORS ({team.collaborators.length})
        </div>
        {team.collaborators.length === 0 ? (
          <p style={{ fontSize: '13px', color: '#94a3b8' }}>No collaborators yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {team.collaborators.map((c) => (
              <div key={c._id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <img src={c.avatarUrl} alt={c.username}
                    style={{ width: '28px', height: '28px', borderRadius: '50%' }} />
                  <span style={{ fontSize: '14px' }}>{c.username}</span>
                </div>
                {isOwner && (
                  <button onClick={() => handleRemove(c._id)}
                    style={{ fontSize: '12px', color: '#f43f5e', background: 'none', border: 'none', cursor: 'pointer' }}>
                    Remove
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite form — only owner can invite */}
      {isOwner && (
        <div style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
          <div style={{ fontSize: '13px', fontWeight: '500', marginBottom: '8px' }}>Invite Collaborator</div>
          <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
            Enter their GitHub username. They must have logged into LaunchPad at least once.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleInvite()}
              placeholder="github-username"
              style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', fontFamily: 'monospace' }}
            />
            <button onClick={handleInvite} disabled={loading}
              style={{ padding: '8px 16px', background: loading ? '#aaa' : '#0070f3', color: '#fff', border: 'none', borderRadius: '8px', cursor: loading ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
              {loading ? 'Inviting…' : 'Invite'}
            </button>
          </div>
        </div>
      )}

      {message && (
        <div style={{ marginTop: '10px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '13px', color: '#166534' }}>
          ✅ {message}
        </div>
      )}
      {error && (
        <div style={{ marginTop: '10px', padding: '10px 14px', background: '#fff1f2', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '13px', color: '#b91c1c' }}>
          {error}
        </div>
      )}
    </div>
  );
}