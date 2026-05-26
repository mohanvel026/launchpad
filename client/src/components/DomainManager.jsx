import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function DomainManager({ project }) {
  const [customDomain, setCustomDomain] = useState(project.customDomain || '');
  const [saving,       setSaving]       = useState(false);
  const [ssl,          setSsl]          = useState(false);
  const [message,      setMessage]      = useState('');
  const [error,        setError]        = useState('');

  useEffect(() => {
    setCustomDomain(project.customDomain || '');
  }, [project.customDomain]);

  const domain = import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io';
  const subUrl = `http://${project.subdomain}.${domain}`;

  const handleAddDomain = async () => {
    if (!customDomain.trim()) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const res = await api.post(`/domains/${project._id}/custom`, { customDomain: customDomain.trim() });
      setMessage(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add domain');
    } finally { setSaving(false); }
  };

  const handleProvisionSSL = async () => {
    setSsl(true); setError(''); setMessage('');
    try {
      const res = await api.post(`/domains/${project._id}/ssl`);
      setMessage(res.data.message);
    } catch (err) {
      setError(err.response?.data?.message || 'SSL provisioning failed');
    } finally { setSsl(false); }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div className="lp-card glass" style={{ padding: 24 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 16 }}>Edge Subdomain</div>
        <div className="flex-between glass" style={{ padding: '12px 20px', borderRadius: 10 }}>
          <code style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>{subUrl}</code>
          <a href={subUrl} target="_blank" rel="noreferrer" className="lp-btn-secondary" style={{ padding: '6px 12px', fontSize: 12 }}>Open App ↗</a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: 24 }}>
        <div className="lp-card glass" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" strokeWidth="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
             <h3 style={{ margin: 0, fontSize: 16 }}>Automated TLS</h3>
          </div>
          <p className="text-muted" style={{ fontSize: 13, marginBottom: 20 }}>All projects receive automated SSL certificates from Let's Encrypt.</p>
          <button onClick={handleProvisionSSL} disabled={ssl || project.status !== 'live'} className="lp-btn-primary" style={{ width: '100%', fontSize: 13 }}>
            {ssl ? 'Provisioning...' : 'Provision New Certificate'}
          </button>
        </div>

        <div className="lp-card glass" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
             <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
             <h3 style={{ margin: 0, fontSize: 16 }}>Custom Domain</h3>
          </div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={customDomain}
              onChange={(e) => setCustomDomain(e.target.value)}
              placeholder="e.g. my-app.com"
              className="lp-search"
              style={{ flex: 1, backgroundImage: 'none', paddingLeft: 12 }}
            />
            <button onClick={handleAddDomain} disabled={saving} className="lp-btn-secondary" style={{ padding: '0 16px' }}>
              {saving ? '...' : 'Add'}
            </button>
          </div>
          {project.customDomain && (
            <div style={{ fontSize: 13, color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}></div>
              Configured: {project.customDomain}
            </div>
          )}
        </div>
      </div>

      {message && <div className="glass" style={{ padding: 12, borderRadius: 10, color: 'var(--accent-success)', fontSize: 13, border: '1px solid rgba(52, 211, 153, 0.2)' }}>{message}</div>}
      {error && <div className="glass" style={{ padding: 12, borderRadius: 10, color: 'var(--accent-danger)', fontSize: 13, border: '1px solid rgba(248, 113, 113, 0.2)' }}>{error}</div>}
    </div>
  );
}