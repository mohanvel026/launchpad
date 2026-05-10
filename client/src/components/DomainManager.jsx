import { useState } from 'react';
import api from '../lib/api';

export default function DomainManager({ project }) {
  const [customDomain, setCustomDomain] = useState(project.customDomain || '');
  const [saving,       setSaving]       = useState(false);
  const [ssl,          setSsl]          = useState(false);
  const [message,      setMessage]      = useState('');
  const [error,        setError]        = useState('');

  const domain    = import.meta.env.VITE_DOMAIN || 'launchpad.dev';
  const subUrl    = `https://${project.subdomain}.${domain}`;

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

  const s = { fontFamily: 'system-ui, sans-serif' };

  return (
    <div style={s}>

      {/* Subdomain (auto-assigned) */}
      <div style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '13px', fontWeight: '500', color: '#374151', marginBottom: '6px' }}>
          Your free subdomain
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <code style={{ background: '#f1f5f9', padding: '8px 14px', borderRadius: '8px', fontSize: '13px', flex: 1 }}>
            {subUrl}
          </code>
          <a href={subUrl} target="_blank" rel="noreferrer"
            style={{ fontSize: '12px', color: '#0070f3', textDecoration: 'none', whiteSpace: 'nowrap' }}>
            Open ↗
          </a>
        </div>
      </div>

      {/* SSL provisioning */}
      <div style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
        <div style={{ fontWeight: '500', fontSize: '13px', marginBottom: '4px' }}>SSL Certificate</div>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
          Provision a free Let's Encrypt HTTPS certificate for your subdomain.
        </div>
        <button onClick={handleProvisionSSL} disabled={ssl || project.status !== 'live'}
          style={{ padding: '8px 16px', background: ssl ? '#aaa' : '#059669', color: '#fff', border: 'none', borderRadius: '8px', cursor: ssl ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
          {ssl ? 'Provisioning…' : '🔒 Provision SSL'}
        </button>
        {project.status !== 'live' && (
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>Deploy your app first to enable SSL.</div>
        )}
      </div>

      {/* Custom domain */}
      <div style={{ padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
        <div style={{ fontWeight: '500', fontSize: '13px', marginBottom: '4px' }}>Custom Domain</div>
        <div style={{ fontSize: '12px', color: '#64748b', marginBottom: '10px' }}>
          Attach your own domain. After saving, add a CNAME record pointing to your subdomain.
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
          <input
            value={customDomain}
            onChange={(e) => setCustomDomain(e.target.value)}
            placeholder="myapp.com"
            style={{ flex: 1, padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px' }}
          />
          <button onClick={handleAddDomain} disabled={saving}
            style={{ padding: '8px 16px', background: saving ? '#aaa' : '#0070f3', color: '#fff', border: 'none', borderRadius: '8px', cursor: saving ? 'not-allowed' : 'pointer', fontSize: '13px' }}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
        {project.customDomain && (
          <div style={{ fontSize: '12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '8px 12px', color: '#166534' }}>
            ✅ Custom domain: <strong>{project.customDomain}</strong>
          </div>
        )}
        {/* DNS instructions */}
        <div style={{ marginTop: '10px', fontSize: '12px', color: '#64748b' }}>
          <strong>DNS setup:</strong> Add this CNAME record to your domain registrar:
          <code style={{ display: 'block', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px', marginTop: '6px', fontFamily: 'monospace' }}>
            CNAME → {project.subdomain}.{domain}
          </code>
        </div>
      </div>

      {/* Feedback messages */}
      {message && (
        <div style={{ marginTop: '10px', padding: '10px 14px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '13px', color: '#166534' }}>
          {message}
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