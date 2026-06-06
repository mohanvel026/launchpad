import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../lib/api';
import { useAuth } from '../hooks/useAuth';

export default function Settings() {
  const navigate         = useNavigate();
  const { user, logout } = useAuth();

  const [stats,       setStats]       = useState(null);
  const [token,       setToken]       = useState('');
  const [tokenShown,  setTokenShown]  = useState(false);
  const [email,       setEmail]       = useState('');
  const [deleteInput, setDeleteInput] = useState('');
  const [message,     setMessage]     = useState('');
  const [error,       setError]       = useState('');
  const [saving,      setSaving]      = useState(false);
  const [copied,      setCopied]      = useState(false);

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

  const handleCopyToken = () => {
    navigator.clipboard.writeText(token);
    setCopied(true);
    setMessage('Token copied to clipboard!');
    setTimeout(() => setCopied(false), 2000);
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

  const statCards = stats ? [
    {
      label: 'Plan',
      value: stats.plan,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
        </svg>
      ),
      color: '#818cf8',
      bg: 'rgba(129,140,248,0.08)',
      border: 'rgba(129,140,248,0.2)',
    },
    {
      label: 'Total Projects',
      value: stats.totalProjects,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
      ),
      color: '#38bdf8',
      bg: 'rgba(56,189,248,0.08)',
      border: 'rgba(56,189,248,0.2)',
    },
    {
      label: 'Live Apps',
      value: stats.liveProjects,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
          <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
        </svg>
      ),
      color: '#10b981',
      bg: 'rgba(16,185,129,0.08)',
      border: 'rgba(16,185,129,0.2)',
    },
    {
      label: 'Apps Remaining',
      value: stats.appsRemaining,
      icon: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
        </svg>
      ),
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.08)',
      border: 'rgba(245,158,11,0.2)',
    },
  ] : [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-main)', fontFamily: 'var(--font-sans)' }}>
      {/* Top nav bar */}
      <header className="lp-header" style={{ display: 'block', padding: 0 }}>
        <div style={{ maxWidth: 1100, margin: '0 auto', height: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 40px' }}>
          <button
            onClick={() => navigate('/dashboard')}
            style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 14, fontFamily: 'var(--font-sans)', fontWeight: 500, transition: 'color 0.2s', padding: 0 }}
            onMouseEnter={e => e.currentTarget.style.color = 'var(--text-main)'}
            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
            </svg>
            Dashboard
          </button>
          <div className="lp-logo">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="url(#grad-s)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <defs><linearGradient id="grad-s" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stopColor="#38bdf8"/><stop offset="100%" stopColor="#818cf8"/></linearGradient></defs>
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
            </svg>
            LaunchLive
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {user?.avatarUrl && <img src={user.avatarUrl} alt={user.username} style={{ width: 28, height: 28, borderRadius: '50%', border: '2px solid var(--border-strong)' }} />}
            <span style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>{user?.username}</span>
          </div>
        </div>
      </header>

      {/* Page body */}
      <div style={{ maxWidth: 780, margin: '0 auto', padding: '48px 40px' }}>

        {/* Page title */}
        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'var(--gradient-glow)',
              border: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--accent-primary)',
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 1.91 11.77A10 10 0 0 1 2.93 19.07 10 10 0 0 1 4.93 4.93a10 10 0 0 1 11.77 1.91"/>
              </svg>
            </div>
            <h1 style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.04em' }}>Settings</h1>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 14, marginLeft: 48 }}>Manage your account, API tokens, and preferences.</p>
        </div>

        {/* Alerts */}
        {message && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
            padding: '12px 16px', borderRadius: 10, color: '#34d399', fontSize: 13, marginBottom: 20,
            animation: 'fade-in-up 0.3s ease forwards',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            {message}
          </div>
        )}
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
            padding: '12px 16px', borderRadius: 10, color: '#f87171', fontSize: 13, marginBottom: 20,
            animation: 'fade-in-up 0.3s ease forwards',
          }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            {error}
          </div>
        )}

        {/* ─── Account Overview ─── */}
        {stats && (
          <section className="lp-card fade-in" style={{ marginBottom: 20, padding: '24px 28px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
              <span className="lp-section-label" style={{ margin: 0 }}>Account Overview</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
              {statCards.map((s) => (
                <div key={s.label} style={{
                  background: s.bg,
                  border: `1px solid ${s.border}`,
                  borderRadius: 12,
                  padding: '16px 18px',
                  transition: 'transform 0.2s, box-shadow 0.2s',
                }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = `0 8px 24px ${s.bg}`; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                >
                  <div style={{ color: s.color, marginBottom: 10 }}>{s.icon}</div>
                  <div style={{ fontSize: 26, fontWeight: 800, color: s.color, letterSpacing: '-0.04em', lineHeight: 1 }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-dim)', marginTop: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{s.label}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Profile ─── */}
        <section className="lp-card fade-in" style={{ marginBottom: 20, padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
            </svg>
            <h3 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>Profile</h3>
          </div>

          {/* Avatar row */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20,
            padding: '14px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: 10,
            border: '1px solid var(--border)',
          }}>
            {user?.avatarUrl && (
              <img src={user.avatarUrl} alt={user.username} style={{
                width: 48, height: 48, borderRadius: '50%',
                border: '2px solid var(--border-strong)',
              }} />
            )}
            <div>
              <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 2 }}>@{user?.username}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>GitHub account connected</div>
            </div>
            <div style={{ marginLeft: 'auto' }}>
              <span className="lp-badge success">Active</span>
            </div>
          </div>

          {/* Email field */}
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Email (for notifications)
          </label>
          <input
            className="lp-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            type="email"
            placeholder="your@email.com"
            style={{ marginBottom: 14 }}
          />
          <button className="lp-btn-primary" onClick={handleSaveProfile} disabled={saving}>
            {saving ? (
              <>
                <div className="loading-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                Saving…
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                Save Changes
              </>
            )}
          </button>
        </section>

        {/* ─── CLI Token ─── */}
        <section className="lp-card fade-in" style={{ marginBottom: 20, padding: '24px 28px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent-secondary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
              <h3 style={{ fontSize: 15, fontWeight: 700, letterSpacing: '-0.02em' }}>CLI Access Token</h3>
            </div>
            <button
              className={tokenShown ? 'lp-btn-secondary' : 'lp-btn-primary'}
              onClick={handleShowToken}
              style={{ fontSize: 13, padding: '7px 16px' }}
            >
              {tokenShown ? (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                  Hide Token
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  Generate Token
                </>
              )}
            </button>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
            Use this token to authenticate the LaunchLive CLI. Valid for 30 days.
          </p>

          {tokenShown && token && (
            <div style={{ marginBottom: 16, animation: 'fade-in-up 0.3s ease forwards' }}>
              {/* Token box */}
              <div style={{
                background: '#010d1a',
                border: '1px solid rgba(16,185,129,0.2)',
                borderRadius: 10,
                padding: '16px 18px',
                marginBottom: 10,
                position: 'relative',
              }}>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 12,
                  color: '#4ade80', wordBreak: 'break-all', lineHeight: 1.7,
                  paddingRight: 80,
                }}>
                  {token}
                </div>
                <button
                  onClick={handleCopyToken}
                  style={{
                    position: 'absolute', top: 12, right: 12,
                    background: copied ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.05)',
                    border: `1px solid ${copied ? 'rgba(16,185,129,0.4)' : 'var(--border-strong)'}`,
                    borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
                    fontSize: 12, fontWeight: 600, color: copied ? '#34d399' : 'var(--text-muted)',
                    fontFamily: 'var(--font-sans)', display: 'flex', alignItems: 'center', gap: 5,
                    transition: 'all 0.2s',
                  }}
                >
                  {copied ? (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Copied</>
                  ) : (
                    <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</>
                  )}
                </button>
              </div>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8,
                background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)',
                borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#fbbf24',
              }}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                Never share this token. It provides full access to your account.
              </div>
            </div>
          )}

          {/* CLI Setup */}
          <div style={{
            background: 'rgba(255,255,255,0.015)', border: '1px solid var(--border)',
            borderRadius: 10, overflow: 'hidden',
          }}>
            <div style={{
              padding: '10px 16px', borderBottom: '1px solid var(--border)',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, color: 'var(--text-dim)', fontWeight: 600,
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
              CLI Quick Setup
            </div>
            <div style={{ padding: '14px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, lineHeight: 2.2 }}>
              {[
                { cmd: 'npm install -g launchlive-cli', color: '#94a3b8' },
                { cmd: 'launchlive login', color: '#38bdf8' },
                { cmd: 'launchlive deploy --repo username/my-app', color: '#4ade80' },
                { cmd: 'launchlive list', color: '#818cf8' },
              ].map((line, i) => (
                <div key={i} style={{ color: line.color, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--text-dim)', userSelect: 'none' }}>$</span>
                  {line.cmd}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ─── Danger Zone ─── */}
        <section style={{
          padding: '24px 28px',
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(239,68,68,0.03)',
          border: '1px solid rgba(239,68,68,0.2)',
          backgroundImage: 'linear-gradient(135deg, rgba(239,68,68,0.04) 0%, rgba(239,68,68,0.01) 100%)',
          backdropFilter: 'blur(12px)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#ef4444', letterSpacing: '-0.02em' }}>Danger Zone</h3>
          </div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Permanently delete your account and all projects. <strong style={{ color: '#f87171' }}>This cannot be undone.</strong>
          </p>
          <label style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-dim)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Type <code style={{ background: 'rgba(239,68,68,0.1)', padding: '1px 6px', borderRadius: 4, color: '#f87171', fontFamily: 'var(--font-mono)' }}>{user?.username}</code> to confirm
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <input
              className="lp-input"
              value={deleteInput}
              onChange={(e) => setDeleteInput(e.target.value)}
              placeholder={user?.username}
              style={{
                maxWidth: 260,
                borderColor: deleteInput.length > 0 && deleteInput !== user?.username
                  ? 'rgba(239,68,68,0.5)' : 'var(--border)',
              }}
            />
            <button
              className="lp-btn-danger"
              onClick={handleDeleteAccount}
              disabled={deleteInput !== user?.username}
              style={{
                opacity: deleteInput !== user?.username ? 0.4 : 1,
                cursor: deleteInput !== user?.username ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', gap: 8,
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
              Delete Account
            </button>
          </div>
        </section>

      </div>
    </div>
  );
}