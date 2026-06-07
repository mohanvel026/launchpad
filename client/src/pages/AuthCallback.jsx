import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('token');
    const error  = params.get('error');

    if (token) {
      localStorage.setItem('lp_token', token);
      navigate('/dashboard', { replace: true });
    } else {
      navigate(`/login?error=${error || 'auth_failed'}`, { replace: true });
    }
  }, [navigate]);

  return (
    <div className="launchlive-container flex-center" style={{ minHeight: '100vh', flexDirection: 'column', gap: 16 }}>
      <div className="loading-spinner" style={{ width: 40, height: 40 }} />
      <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Signing you in…</p>
    </div>
  );
}