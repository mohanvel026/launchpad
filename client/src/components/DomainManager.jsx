import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function DomainManager({ project }) {
  const [customDomain, setCustomDomain] = useState(project.customDomain || '');
  const [activeDomain, setActiveDomain] = useState(project.customDomain || null);
  const [saving,       setSaving]       = useState(false);
  const [removing,     setRemoving]     = useState(false);
  const [verifying,    setVerifying]    = useState(false);
  const [ssl,          setSsl]          = useState(false);
  
  // DNS Verification state
  const [dnsStatus,    setDnsStatus]    = useState(null); // { verified: boolean, resolvedTo: string, targetCname: string }
  const [message,      setMessage]      = useState('');
  const [error,        setError]        = useState('');

  useEffect(() => {
    setActiveDomain(project.customDomain || null);
    setCustomDomain(project.customDomain || '');
    setDnsStatus(null);
  }, [project.customDomain]);

  const domain = import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io';
  const subUrl = `http://${project.subdomain}.${domain}`;
  const targetCname = `${project.subdomain}.${domain}`;

  const handleAddDomain = async () => {
    if (!customDomain.trim()) return;
    setSaving(true); setError(''); setMessage(''); setDnsStatus(null);
    try {
      const res = await api.post(`/domains/${project._id}/custom`, { customDomain: customDomain.trim() });
      setMessage(res.data.message);
      setActiveDomain(customDomain.trim());
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add domain');
    } finally { setSaving(false); }
  };

  const handleRemoveDomain = async () => {
    setRemoving(true); setError(''); setMessage(''); setDnsStatus(null);
    try {
      const res = await api.delete(`/domains/${project._id}/custom`);
      setMessage(res.data.message);
      setActiveDomain(null);
      setCustomDomain('');
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove domain');
    } finally { setRemoving(false); }
  };

  const handleVerifyDNS = async () => {
    setVerifying(true); setError(''); setMessage('');
    try {
      const res = await api.get(`/domains/${project._id}/verify`);
      setDnsStatus(res.data);
      if (res.data.verified) {
        setMessage('✨ DNS verification successful! Your domain is pointed correctly.');
      } else {
        setError(`DNS Check failed: Your domain resolves to "${res.data.resolvedTo}" instead of "${res.data.targetCname}".`);
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to verify DNS');
    } finally { setVerifying(false); }
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      
      {/* 1. Edge Subdomain card */}
      <div className="lp-card glass" style={{ padding: 24, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 16, letterSpacing: '0.05em' }}>Default Edge Routing</div>
        <div className="flex-between glass" style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(255, 255, 255, 0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }}></span>
            <code style={{ color: 'var(--accent-primary)', fontWeight: 600, fontSize: 14 }}>{subUrl}</code>
          </div>
          <a href={subUrl} target="_blank" rel="noreferrer" className="lp-btn-secondary" style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, textDecoration: 'none' }}>Open App ↗</a>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 28 }}>
        
        {/* 2. Custom Domain Configuration & Management Card */}
        <div className="lp-card glass" style={{ padding: 26, border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
               <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
               <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Custom Domain</h3>
            </div>
            <p className="text-muted" style={{ fontSize: 13, lineHeight: '1.5', marginBottom: 20 }}>
              Point a custom domain (e.g., <code style={{ color: '#c084fc' }}>my-app.com</code>) to your deployment.
            </p>

            {!activeDomain ? (
              <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                <input
                  value={customDomain}
                  onChange={(e) => setCustomDomain(e.target.value)}
                  placeholder="e.g. my-resume-app.com"
                  className="lp-search"
                  style={{ flex: 1, backgroundImage: 'none', paddingLeft: 14, borderRadius: 8, fontSize: 13, height: 42, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
                />
                <button onClick={handleAddDomain} disabled={saving} className="lp-btn-primary" style={{ padding: '0 20px', borderRadius: 8, fontSize: 13, height: 42 }}>
                  {saving ? 'Saving...' : 'Add'}
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 20 }}>
                <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(52, 211, 153, 0.05)', border: '1px solid rgba(52, 211, 153, 0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 14, color: 'var(--accent-success)', display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'currentColor', boxShadow: '0 0 8px currentColor' }}></div>
                    {activeDomain}
                  </div>
                  <button onClick={handleRemoveDomain} disabled={removing} className="lp-btn-secondary" style={{ padding: '4px 10px', fontSize: 12, color: 'var(--accent-danger)', border: '1px solid rgba(239, 68, 68, 0.2)', background: 'transparent', height: 'auto' }}>
                    {removing ? 'Removing...' : 'Remove'}
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <button onClick={handleVerifyDNS} disabled={verifying} className="lp-btn-secondary" style={{ padding: '10px 0', fontSize: 13, borderRadius: 8 }}>
                    {verifying ? 'Verifying...' : '🔍 Verify DNS'}
                  </button>
                  <button onClick={handleProvisionSSL} disabled={ssl || project.status !== 'live'} className="lp-btn-primary" style={{ padding: '10px 0', fontSize: 13, borderRadius: 8 }}>
                    {ssl ? 'Securing...' : '🔒 Provision SSL'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 3. DNS Configuration Settings Instructions Box */}
        <div className="lp-card glass" style={{ padding: 26, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
             <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" strokeWidth="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
             <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>DNS Settings</h3>
          </div>
          <p className="text-muted" style={{ fontSize: 13, lineHeight: '1.5', marginBottom: 14 }}>
            Go to your domain registrar (e.g. Cloudflare, GoDaddy) and add the following CNAME record:
          </p>
          <div className="glass" style={{ padding: 14, borderRadius: 10, background: 'rgba(0,0,0,0.15)', display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
            <div className="flex-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 6 }}>
              <span style={{ color: 'var(--text-muted)' }}>Type</span>
              <strong style={{ color: 'var(--accent-primary)' }}>CNAME</strong>
            </div>
            <div className="flex-between" style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 6 }}>
              <span style={{ color: 'var(--text-muted)' }}>Name / Host</span>
              <code style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>@</code> or <code style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4 }}>www</code>
            </div>
            <div className="flex-between">
              <span style={{ color: 'var(--text-muted)' }}>Target / Value</span>
              <code style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: 4, wordBreak: 'break-all' }}>{targetCname}</code>
            </div>
          </div>
        </div>

      </div>

      {/* 4. Interactive Feedback Messages */}
      {message && (
        <div className="glass" style={{ padding: '14px 20px', borderRadius: 10, color: 'var(--accent-success)', fontSize: 13, border: '1px solid rgba(52, 211, 153, 0.25)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(16, 185, 129, 0.03)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          <div>{message}</div>
        </div>
      )}
      {error && (
        <div className="glass" style={{ padding: '14px 20px', borderRadius: 10, color: 'var(--accent-danger)', fontSize: 13, border: '1px solid rgba(239, 68, 68, 0.25)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239, 68, 68, 0.03)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
          <div>{error}</div>
        </div>
      )}

      {/* 5. DNS Details Resolution Box (If Checked) */}
      {dnsStatus && (
        <div className="glass" style={{ padding: 20, borderRadius: 12, border: `1px solid ${dnsStatus.verified ? 'rgba(52, 211, 153, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`, background: 'rgba(255,255,255,0.01)' }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 14, fontWeight: 700, color: dnsStatus.verified ? 'var(--accent-success)' : 'var(--accent-danger)' }}>
            {dnsStatus.verified ? '✅ DNS Configuration Verified' : '❌ DNS Configuration Issue'}
          </h4>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
            <div>
              <span className="text-muted">Target Domain:</span> <code style={{ color: 'var(--accent-primary)' }}>{dnsStatus.targetCname}</code>
            </div>
            <div>
              <span className="text-muted">Currently Resolves To:</span> <code style={{ color: dnsStatus.verified ? 'var(--accent-success)' : 'var(--accent-danger)' }}>{dnsStatus.resolvedTo}</code>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}