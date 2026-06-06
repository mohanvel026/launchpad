import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function DomainManager({ project, onUpdate }) {
  const [customDomain, setCustomDomain] = useState(project.customDomain || '');
  const [saving,       setSaving]       = useState(false);
  const [removing,     setRemoving]     = useState(false);
  const [verifying,    setVerifying]    = useState(false);
  const [ssl,          setSsl]          = useState(false);
  
  // Detailed domain status fetched from backend
  const [domainInfo,   setDomainInfo]   = useState(null);
  const [infoLoading,  setInfoLoading]  = useState(true);
  
  // Local verification details/messages
  const [dnsStatus,    setDnsStatus]    = useState(null);
  const [message,      setMessage]      = useState('');
  const [error,        setError]        = useState('');
  const [copiedText,   setCopiedText]   = useState('');
  const [mockVerify,   setMockVerify]   = useState(process.env.NODE_ENV === 'development' || true); // Default true for testing convenience

  const fetchDomainInfo = async () => {
    try {
      const res = await api.get(`/domains/${project._id}`);
      setDomainInfo(res.data);
      if (res.data.customDomain) {
        setCustomDomain(res.data.customDomain);
      }
    } catch (err) {
      console.error('[DomainManager] Error fetching domain info:', err);
    } finally {
      setInfoLoading(false);
    }
  };

  useEffect(() => {
    fetchDomainInfo();
  }, [project._id]);

  const domain = import.meta.env.VITE_DOMAIN || '129.159.22.142.nip.io';
  const subUrl = `http://${project.subdomain}.${domain}`;
  const targetCname = `${project.subdomain}.${domain}`;

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedText(type);
    setTimeout(() => setCopiedText(''), 2000);
  };

  const handleAddDomain = async () => {
    if (!customDomain.trim()) return;
    setSaving(true); setError(''); setMessage(''); setDnsStatus(null);
    try {
      const res = await api.post(`/domains/${project._id}/custom`, { customDomain: customDomain.trim() });
      setMessage(res.data.message);
      await fetchDomainInfo();
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to add domain');
    } finally { setSaving(false); }
  };

  const handleRemoveDomain = async () => {
    if (!window.confirm('Are you sure you want to remove this custom domain? This will reset your SSL configuration.')) return;
    setRemoving(true); setError(''); setMessage(''); setDnsStatus(null);
    try {
      const res = await api.delete(`/domains/${project._id}/custom`);
      setMessage(res.data.message);
      setCustomDomain('');
      setDomainInfo(null);
      await fetchDomainInfo();
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to remove domain');
    } finally { setRemoving(false); }
  };

  const handleVerifyDNS = async () => {
    setVerifying(true); setError(''); setMessage('');
    try {
      const url = `/domains/${project._id}/verify${mockVerify ? '?mock=true' : ''}`;
      const res = await api.get(url);
      setDnsStatus(res.data);
      await fetchDomainInfo();
      if (onUpdate) onUpdate();

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
      await fetchDomainInfo();
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.response?.data?.message || 'SSL provisioning failed');
    } finally { setSsl(false); }
  };

  // Determine current overall state for styling
  const activeDomain = domainInfo?.customDomain;
  const domainStatus = domainInfo?.customDomainStatus || 'none'; // 'none', 'pending_dns', 'dns_verified', 'active', 'failed'
  const sslStatus = domainInfo?.sslStatus || 'none'; // 'none', 'pending', 'active', 'failed'
  
  // Calculate relative date for SSL expiration
  const getExpirationDays = () => {
    if (!domainInfo?.sslExpiresAt) return null;
    const diffTime = new Date(domainInfo.sslExpiresAt) - new Date();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  };
  const expirationDays = getExpirationDays();

  // Color mappings
  const getStatusConfig = () => {
    if (!activeDomain) return null;
    if (domainStatus === 'active' && sslStatus === 'active') {
      return {
        label: 'Active & Secure',
        color: '#10b981',
        bg: 'rgba(16, 185, 129, 0.04)',
        border: 'rgba(16, 185, 129, 0.2)',
        glow: '0 0 16px rgba(16, 185, 129, 0.15)'
      };
    }
    if (domainStatus === 'dns_verified' || sslStatus === 'pending') {
      return {
        label: 'DNS Verified (SSL Pending)',
        color: '#f59e0b',
        bg: 'rgba(245, 158, 11, 0.04)',
        border: 'rgba(245, 158, 11, 0.2)',
        glow: '0 0 16px rgba(245, 158, 11, 0.15)'
      };
    }
    if (domainStatus === 'failed' || sslStatus === 'failed') {
      return {
        label: 'Configuration Issues Detected',
        color: '#ef4444',
        bg: 'rgba(239, 68, 68, 0.04)',
        border: 'rgba(239, 68, 68, 0.2)',
        glow: '0 0 16px rgba(239, 68, 68, 0.15)'
      };
    }
    return {
      label: 'Pending DNS Configuration',
      color: '#a855f7',
      bg: 'rgba(168, 85, 247, 0.04)',
      border: 'rgba(168, 85, 247, 0.2)',
      glow: '0 0 16px rgba(168, 85, 247, 0.15)'
    };
  };

  const statusConfig = getStatusConfig();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
      
      {/* Default Edge Subdomain Routing Info */}
      <div className="lp-card glass" style={{ padding: 24, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Default Edge Routing</div>
          <span style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.1)', color: '#10b981', padding: '3px 8px', borderRadius: 4, fontWeight: 600 }}>Active</span>
        </div>
        <div className="flex-between glass" style={{ padding: '14px 20px', borderRadius: 12, background: 'rgba(255, 255, 255, 0.02)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: '#10b981', boxShadow: '0 0 10px #10b981' }}></span>
            <code style={{ color: 'var(--accent-primary)', fontWeight: 600, fontSize: 14 }}>{subUrl}</code>
          </div>
          <a href={subUrl} target="_blank" rel="noreferrer" className="lp-btn-secondary" style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8, textDecoration: 'none' }}>Open App ↗</a>
        </div>
      </div>

      {infoLoading ? (
        <div className="lp-card glass" style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
          <div className="spinner" style={{ margin: '0 auto 16px auto', border: '3px solid rgba(255,255,255,0.1)', borderTop: '3px solid var(--accent-primary)', borderRadius: '50%', width: 28, height: 28, animation: 'spin 1s linear infinite' }}></div>
          Checking domain config...
        </div>
      ) : (
        <>
          {/* Active Domain Overview Panel */}
          {activeDomain && statusConfig && (
            <div className="lp-card" style={{
              padding: 24,
              background: statusConfig.bg,
              border: `1px solid ${statusConfig.border}`,
              boxShadow: statusConfig.glow,
              borderRadius: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 16
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Custom Domain Linked</div>
                  <h2 style={{ margin: 0, fontSize: 24, fontWeight: 800, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: 10 }}>
                    {activeDomain}
                    <a href={`https://${activeDomain}`} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'none', fontSize: 16 }}>↗</a>
                  </h2>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'rgba(0, 0, 0, 0.2)', padding: '6px 12px', borderRadius: 30, border: '1px solid rgba(255, 255, 255, 0.05)' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: statusConfig.color, boxShadow: `0 0 8px ${statusConfig.color}` }}></span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-main)' }}>{statusConfig.label}</span>
                </div>
              </div>

              {/* SSL Details */}
              {sslStatus === 'active' && domainInfo.sslExpiresAt && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, borderTop: '1px solid rgba(255, 255, 255, 0.05)', paddingTop: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
                    <span style={{ color: 'var(--text-main)', fontWeight: 500 }}>SSL Certificate Active</span>
                  </div>
                  <span>•</span>
                  <span>Expires in <strong>{expirationDays} days</strong> ({new Date(domainInfo.sslExpiresAt).toLocaleDateString()})</span>
                  <span>•</span>
                  <span style={{ color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'currentColor' }}></span> Auto-Renewing
                  </span>
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 28 }}>
            
            {/* 1. Custom Domain Management Card */}
            <div className="lp-card glass" style={{ padding: 26, border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                   <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Domain Setup</h3>
                </div>
                <p className="text-muted" style={{ fontSize: 13, lineHeight: '1.5', marginBottom: 20 }}>
                  Route web traffic from your own DNS provider to this project container by attaching a custom domain.
                </p>

                {!activeDomain ? (
                  <div style={{ display: 'flex', gap: 10, marginBottom: 20 }}>
                    <input
                      value={customDomain}
                      onChange={(e) => setCustomDomain(e.target.value)}
                      placeholder="e.g. my-launchpad-app.com"
                      className="lp-search"
                      style={{ flex: 1, backgroundImage: 'none', paddingLeft: 14, borderRadius: 8, fontSize: 13, height: 42, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)' }}
                    />
                    <button onClick={handleAddDomain} disabled={saving} className="lp-btn-primary" style={{ padding: '0 20px', borderRadius: 8, fontSize: 13, height: 42 }}>
                      {saving ? 'Linking...' : 'Link'}
                    </button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 10 }}>
                    <div style={{ padding: '12px 16px', borderRadius: 8, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <code style={{ fontSize: 14, color: 'var(--text-main)', fontWeight: 600 }}>{activeDomain}</code>
                      <button onClick={handleRemoveDomain} disabled={removing} className="lp-btn-secondary" style={{ padding: '6px 12px', fontSize: 12, color: 'var(--accent-danger)', border: '1px solid rgba(239, 68, 68, 0.15)', background: 'transparent', height: 'auto' }}>
                        {removing ? 'Unlinking...' : 'Unlink Domain'}
                      </button>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button onClick={handleVerifyDNS} disabled={verifying} className="lp-btn-secondary" style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 8, fontWeight: 600 }}>
                          {verifying ? '🔍 Running DNS Checks...' : '🔍 Trigger DNS Lookup'}
                        </button>
                        <button onClick={handleProvisionSSL} disabled={ssl || domainStatus !== 'dns_verified' || project.status !== 'live'} className="lp-btn-primary" style={{ flex: 1, padding: '10px 0', fontSize: 13, borderRadius: 8, fontWeight: 600 }}>
                          {ssl ? '🔒 Provisioning SSL...' : '🔒 Secure with SSL'}
                        </button>
                      </div>

                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', marginTop: 4 }}>
                        <input
                          type="checkbox"
                          checked={mockVerify}
                          onChange={(e) => setMockVerify(e.target.checked)}
                          style={{ accentColor: 'var(--accent-primary)' }}
                        />
                        <span>Mock DNS verification (Useful for testing without live DNS records)</span>
                      </label>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 2. DNS Target Instructions Card */}
            <div className="lp-card glass" style={{ padding: 26, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                 <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" strokeWidth="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                 <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>DNS Record Config</h3>
              </div>
              <p className="text-muted" style={{ fontSize: 13, lineHeight: '1.5', marginBottom: 14 }}>
                Log in to your DNS provider (e.g. Cloudflare, Namecheap) and create a CNAME record:
              </p>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {/* CNAME Name */}
                <div className="glass" style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Host / Name</div>
                    <code style={{ fontSize: 13, color: 'var(--accent-primary)', fontWeight: 600 }}>@</code>
                  </div>
                  <button
                    onClick={() => copyToClipboard('@', 'host')}
                    style={{ background: 'transparent', border: 'none', color: copiedText === 'host' ? '#10b981' : 'var(--text-muted)', cursor: 'pointer', fontSize: 12 }}
                  >
                    {copiedText === 'host' ? 'Copied' : '📋 Copy'}
                  </button>
                </div>

                {/* CNAME Value */}
                <div className="glass" style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(0,0,0,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ minWidth: 0, flex: 1, marginRight: 10 }}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Value / Destination</div>
                    <code style={{ fontSize: 12, color: 'var(--text-main)', fontWeight: 600, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{targetCname}</code>
                  </div>
                  <button
                    onClick={() => copyToClipboard(targetCname, 'value')}
                    style={{ background: 'transparent', border: 'none', color: copiedText === 'value' ? '#10b981' : 'var(--text-muted)', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                  >
                    {copiedText === 'value' ? 'Copied' : '📋 Copy'}
                  </button>
                </div>
              </div>
            </div>

          </div>

          {/* Stepper DNS Connection Timeline */}
          {activeDomain && (
            <div className="lp-card glass" style={{ padding: 26, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <h4 style={{ margin: '0 0 20px 0', fontSize: 15, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>Connection Pipeline Checklist</h4>
              
              <div style={{ display: 'flex', flexDirection: 'column', gap: 24, position: 'relative' }}>
                {/* Connecting Line */}
                <div style={{
                  position: 'absolute',
                  left: 15,
                  top: 20,
                  bottom: 20,
                  width: 2,
                  background: 'rgba(255,255,255,0.06)'
                }}></div>

                {/* Step 1: Linked */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: '#10b981',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 10px rgba(16, 185, 129, 0.3)',
                    zIndex: 2,
                    fontSize: 12,
                    color: '#fff'
                  }}>✓</div>
                  <div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>Step 1: Domain Connected to LaunchPad</h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Successfully associated the domain <code style={{ color: 'var(--accent-primary)' }}>{activeDomain}</code> with your deployment configuration.</p>
                  </div>
                </div>

                {/* Step 2: CNAME Records */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '#10b981' : 'rgba(255,255,255,0.05)',
                    border: (domainStatus === 'dns_verified' || domainStatus === 'active') ? 'none' : '2px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '0 0 10px rgba(16, 185, 129, 0.3)' : 'none',
                    zIndex: 2,
                    fontSize: 12,
                    color: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '#fff' : 'var(--text-muted)'
                  }}>
                    {(domainStatus === 'dns_verified' || domainStatus === 'active') ? '✓' : '2'}
                  </div>
                  <div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, color: (domainStatus === 'dns_verified' || domainStatus === 'active') ? 'var(--text-main)' : 'var(--text-muted)' }}>Step 2: DNS Target Match Checks</h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>CNAME registry records check whether the configuration points to <code style={{ color: 'var(--accent-primary)' }}>{targetCname}</code>.</p>
                  </div>
                </div>

                {/* Step 3: Propagation */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '#10b981' : 'rgba(255,255,255,0.05)',
                    border: (domainStatus === 'dns_verified' || domainStatus === 'active') ? 'none' : '2px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '0 0 10px rgba(16, 185, 129, 0.3)' : 'none',
                    zIndex: 2,
                    fontSize: 12,
                    color: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '#fff' : 'var(--text-muted)'
                  }}>
                    {(domainStatus === 'dns_verified' || domainStatus === 'active') ? '✓' : '3'}
                  </div>
                  <div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, color: (domainStatus === 'dns_verified' || domainStatus === 'active') ? 'var(--text-main)' : 'var(--text-muted)' }}>Step 3: Public DNS Propagation</h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Checks DNS resolution over the internet to verify it matches our server IP <code style={{ color: 'var(--accent-success)' }}>129.159.22.142</code>.</p>
                  </div>
                </div>

                {/* Step 4: SSL Active */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: sslStatus === 'active' ? '#10b981' : 'rgba(255,255,255,0.05)',
                    border: sslStatus === 'active' ? 'none' : '2px solid rgba(255,255,255,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: sslStatus === 'active' ? '0 0 10px rgba(16, 185, 129, 0.3)' : 'none',
                    zIndex: 2,
                    fontSize: 12,
                    color: sslStatus === 'active' ? '#fff' : 'var(--text-muted)'
                  }}>
                    {sslStatus === 'active' ? '✓' : '4'}
                  </div>
                  <div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, color: sslStatus === 'active' ? 'var(--text-main)' : 'var(--text-muted)' }}>Step 4: SSL Certificate Routing Activation</h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Generate and bind Let's Encrypt TLS credentials for end-to-end HTTPS encryption.</p>
                  </div>
                </div>

              </div>
            </div>
          )}

          {/* Interactive Messages */}
          {message && (
            <div className="glass fade-in" style={{ padding: '14px 20px', borderRadius: 12, color: 'var(--accent-success)', fontSize: 13, border: '1px solid rgba(52, 211, 153, 0.2)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(16, 185, 129, 0.02)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
              <div>{message}</div>
            </div>
          )}
          {error && (
            <div className="glass fade-in" style={{ padding: '14px 20px', borderRadius: 12, color: 'var(--accent-danger)', fontSize: 13, border: '1px solid rgba(239, 68, 68, 0.2)', display: 'flex', alignItems: 'center', gap: 10, background: 'rgba(239, 68, 68, 0.02)' }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
              <div>{error}</div>
            </div>
          )}

          {/* 3. DNS Details Resolution Diagnostic Box */}
          {dnsStatus && (
            <div className="glass fade-in" style={{ padding: 22, borderRadius: 14, border: `1px solid ${dnsStatus.verified ? 'rgba(52, 211, 153, 0.15)' : 'rgba(239, 68, 68, 0.15)'}`, background: 'rgba(255,255,255,0.01)' }}>
              <h4 style={{ margin: '0 0 14px 0', fontSize: 14, fontWeight: 700, color: dnsStatus.verified ? '#10b981' : '#ef4444', display: 'flex', alignItems: 'center', gap: 8 }}>
                {dnsStatus.verified ? (
                  <>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}></span>
                    DNS Configuration Verified
                  </>
                ) : (
                  <>
                    <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: 'currentColor' }}></span>
                    DNS Configuration Issue Detected
                  </>
                )}
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, fontSize: 13 }}>
                <div>
                  <span className="text-muted">Target CNAME Target:</span> <code style={{ color: 'var(--accent-primary)', display: 'block', marginTop: 4 }}>{dnsStatus.targetCname}</code>
                </div>
                <div>
                  <span className="text-muted">Currently Resolves To:</span> <code style={{ color: dnsStatus.verified ? '#10b981' : '#ef4444', display: 'block', marginTop: 4 }}>{dnsStatus.resolvedTo}</code>
                </div>
              </div>
            </div>
          )}
        </>
      )}

    </div>
  );
}