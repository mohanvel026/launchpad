export default function Login() {
  const handleLogin = () => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${base}/auth/github`;
  };

  return (
    <div className="launchpad-container flex-center" style={{ minHeight: '100vh', padding: 20 }}>
      {/* Background grid */}
      <div style={{
        position: 'fixed', inset: 0, zIndex: 0,
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)',
        backgroundSize: '60px 60px',
        pointerEvents: 'none'
      }} />

      <div style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 420, textAlign: 'center' }}>
        {/* Logo */}
        <div style={{ marginBottom: 48 }}>
          <div style={{
            width: 64, height: 64, margin: '0 auto 20px',
            background: 'var(--gradient-primary)',
            borderRadius: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 16px 40px rgba(56,189,248,0.3)'
          }}>
            <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/>
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/>
            </svg>
          </div>
          <h1 className="text-gradient" style={{ fontSize: 40, marginBottom: 12, letterSpacing: '-0.04em' }}>LaunchLive</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 15, lineHeight: 1.6, maxWidth: 320, margin: '0 auto' }}>
            Deploy frontend and backend apps with one click. Built for developers.
          </p>
        </div>

        {/* Card */}
        <div className="lp-card" style={{ padding: '36px 32px', backdropFilter: 'blur(20px)' }}>
          <button
            onClick={handleLogin}
            className="lp-btn-secondary"
            style={{ width: '100%', padding: '14px', fontSize: 15, justifyContent: 'center', gap: 12, border: '1px solid var(--border-strong)' }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/>
            </svg>
            Continue with GitHub
          </button>

          <div style={{ marginTop: 28, fontSize: 13, color: 'var(--text-dim)', display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['Auto-detect stack', 'Env variables', 'Live logs'].map(f => (
              <span key={f} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg>
                {f}
              </span>
            ))}
          </div>
        </div>

        <p style={{ marginTop: 24, fontSize: 12, color: 'var(--text-dim)' }}>
          By signing in, you agree to our Terms of Service.
        </p>
      </div>
    </div>
  );
}