import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export default function Settings() {
  const navigate        = useNavigate();
  const { user, logout } = useAuth();

  const [stats,       setStats]       = useState(null);
  const [token,       setToken]       = useState('');
  const [tokenShown,  setTokenShown]  = useState(false);
  const [email,       setEmail]       = useState('');
  const [deleteInput, setDeleteInput] = useState('');
  const [message,     setMessage]     = useState('');
  const [error,       setError]       = useState('');
  const [saving,      setSaving]      = useState(false);

  useEffect(() => {
    api.get('/settings/stats')
      .then((r) => { setStats(r.data.stats); setEmail(user?.email || ''); })
      .catch(() => {});
  }, [user]);

  const handleSaveProfile = async () => {
    setSaving(true); setError(''); setMessage('');
    try {
      await api.put('/settings/profile', { email });
      setMessage('Profile updated successfully');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally { setSaving(false); }
  };

  const handleShowToken = async () => {
    if (tokenShown) { setTokenShown(false); setToken(''); return; }
    try {
      const res = await api.get('/settings/token');
      setToken(res.data.token);
      setTokenShown(true);
    } catch (err) {
      setError('Failed to get token');
    }
  };

  const handleDeleteAccount = async () => {
    if (deleteInput !== user?.username) {
      setError(`Type "${user?.username}" to confirm`);
      return;
    }
    if (!window.confirm('This will permanently delete your account and all projects. Are you sure?')) return;
    try {
      await api.delete('/settings/account', { data: { confirm: deleteInput } });
      logout();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to delete account');
    }
  };

  const f = { fontFamily: 'system-ui, sans-serif', maxWidth: '700px', margin: '0 auto', padding: '2rem' };
  const section = { border: '1px solid #e2e8f0', borderRadius: '12px', padding: '1.2rem 1.4rem', marginBottom: '1.5rem' };
  const label   = { fontSize: '12px', fontWeight: '500', color: '#64748b', display: 'block', marginBottom: '6px' };
  const input   = { width: '100%', padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' };

  return (
    <div style={f}>
      <button onClick={() => navigate('/dashboard')}
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', marginBottom: '1rem', fontSize: '13px' }}>
        ← Dashboard
      </button>

      <h1 style={{ fontSize: '22px', fontWeight: '700', marginBottom: '1.5rem' }}>Settings</h1>

      {message && <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', padding: '10px 14px', borderRadius: '8px', color: '#166534', fontSize: '13px', marginBottom: '1rem' }}>{message}</div>}
      {error   && <div style={{ background: '#fff1f2', border: '1px solid #fca5a5', padding: '10px 14px', borderRadius: '8px', color: '#b91c1c', fontSize: '13px', marginBottom: '1rem' }}>{error}</div>}

      {/* Account stats */}
      {stats && (
        <div style={section}>
          <h3 style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 1rem' }}>Account Overview</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '12px' }}>
            {[
              { label: 'Plan',          value: stats.plan },
              { label: 'Total Projects', value: stats.totalProjects },
              { label: 'Live Apps',      value: stats.liveProjects },
              { label: 'Apps Remaining', value: stats.appsRemaining },
            ].map((s) => (
              <div key={s.label} style={{ background: '#f8fafc', borderRadius: '8px', padding: '0.8rem', textAlign: 'center' }}>
                <div style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a' }}>{s.value}</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '2px' }}>{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Profile */}
      <div style={section}>
        <h3 style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 1rem' }}>Profile</h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
          {user?.avatarUrl && <img src={user.avatarUrl} alt={user.username} style={{ width: '48px', height: '48px', borderRadius: '50%' }} />}
          <div>
            <div style={{ fontWeight: '600' }}>@{user?.username}</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>GitHub account</div>
          </div>
        </div>
        <label style={label}>Email (for notifications)</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="your@email.com" style={input} />
        <button onClick={handleSaveProfile} disabled={saving}
          style={{ marginTop: '10px', padding: '8px 20px', background: saving ? '#aaa' : '#0070f3', color: '#fff', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>
      </div>

      {/* CLI Token */}
      <div style={section}>
        <h3 style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 4px' }}>CLI Access Token</h3>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px' }}>
          Use this token to authenticate the LaunchLive CLI. Valid for 30 days.
        </p>
        <button onClick={handleShowToken}
          style={{ padding: '8px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', cursor: 'pointer', fontSize: '13px', marginBottom: '10px' }}>
          {tokenShown ? 'Hide Token' : 'Generate Token'}
        </button>
        {tokenShown && token && (
          <div>
            <div style={{ fontFamily: 'monospace', fontSize: '11px', background: '#0f172a', color: '#4ade80', padding: '12px', borderRadius: '8px', wordBreak: 'break-all', marginBottom: '8px' }}>
              {token}
            </div>
            <button onClick={() => { navigator.clipboard.writeText(token); setMessage('Token copied to clipboard!'); }}
              style={{ fontSize: '12px', padding: '5px 12px', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', background: '#fff' }}>
              Copy Token
            </button>
            <p style={{ fontSize: '12px', color: '#f59e0b', marginTop: '8px' }}>
              ⚠️ Never share this token. It provides full access to your account.
            </p>
          </div>
        )}
        <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '12px', marginTop: '10px' }}>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 6px', fontWeight: '500' }}>CLI Setup:</p>
          <code style={{ fontSize: '12px', color: '#374151', display: 'block', lineHeight: '2' }}>
            npm install -g launchlive-cli<br />
            launchlive login<br />
            launchlive deploy --repo username/my-app<br />
            launchlive list
          </code>
        </div>
      </div>

      {/* Danger zone */}
      <div style={{ ...section, borderColor: '#fca5a5' }}>
        <h3 style={{ fontSize: '15px', fontWeight: '600', margin: '0 0 4px', color: '#b91c1c' }}>Danger Zone</h3>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px' }}>
          Permanently delete your account and all projects. This cannot be undone.
        </p>
        <label style={label}>Type <strong>{user?.username}</strong> to confirm</label>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input value={deleteInput} onChange={(e) => setDeleteInput(e.target.value)} placeholder={user?.username}
            style={{ ...input, borderColor: '#fca5a5', maxWidth: '250px' }} />
          <button onClick={handleDeleteAccount} disabled={deleteInput !== user?.username}
            style={{ padding: '8px 16px', background: deleteInput !== user?.username ? '#e2e8f0' : '#ef4444', color: deleteInput !== user?.username ? '#94a3b8' : '#fff', border: 'none', borderRadius: '8px', cursor: deleteInput !== user?.username ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
            Delete Account
          </button>
        </div>
      </div>
    </div>
  );
}