export default function Login() {
  const handleLogin = () => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${base}/auth/github`;
  };

  return (
    <div className="launchpad-container flex-center" style={{ padding: '20px', textAlign: 'center' }}>
      <div className="glass" style={{ maxWidth: 440, width: '100%', padding: '60px 40px', borderRadius: 24, boxShadow: 'var(--shadow-lg)' }}>
        <div style={{ marginBottom: 40 }}>
          <div style={{ 
            width: 72, height: 72, background: 'var(--gradient-primary)', 
            borderRadius: 20, margin: '0 auto 24px', display: 'flex', 
            alignItems: 'center', justifyContent: 'center', boxShadow: '0 12px 32px rgba(56, 189, 248, 0.3)' 
          }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"></path>
              <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"></path>
            </svg>
          </div>
          <h1 className="text-gradient" style={{ fontSize: 42, margin: '0 0 12px' }}>LaunchPad</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: 16, lineHeight: 1.6 }}>
            The professional deployment platform for developers who want to ship faster.
          </p>
        </div>

        <button 
          onClick={handleLogin} 
          className="lp-btn-primary" 
          style={{ width: '100%', padding: '16px', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.43.372.823 1.102.823 2.222 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
          Continue with GitHub
        </button>
        
        <div style={{ marginTop: 32, paddingTop: 32, borderTop: '1px solid var(--border)', fontSize: 13, color: 'var(--text-dim)' }}>
          By continuing, you agree to our <span style={{ textDecoration: 'underline', cursor: 'pointer' }}>Terms of Service</span>.
        </div>
      </div>
    </div>
  );
}