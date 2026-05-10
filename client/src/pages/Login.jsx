export default function Login() {
  const handleLogin = () => {
    const base = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
    window.location.href = `${base}/auth/github`;
  };

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', height: '100vh', gap: '16px',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <h1 style={{ fontSize: '36px', fontWeight: '700', margin: 0 }}>🚀 LaunchPad</h1>
      <p style={{ color: '#555', margin: 0, fontSize: '15px' }}>
        Deploy your fullstack apps — free, forever.
      </p>
      <button
        onClick={handleLogin}
        style={{
          padding: '10px 24px', fontSize: '14px', cursor: 'pointer',
          borderRadius: '8px', border: 'none',
          background: '#24292e', color: '#fff', fontWeight: '500',
        }}
      >
        Continue with GitHub
      </button>
    </div>
  );
}