import { useState, useEffect } from 'react';
import api from '../lib/api';

export default function DomainManager({ project, onUpdate }) {
  const domain = import.meta.env.VITE_DOMAIN || 'launchlive.in';
  
  const [domainPrefix, setDomainPrefix] = useState(project.subdomain || '');
  const [domainSuffix, setDomainSuffix] = useState(`.${domain}`);
  const [customSuffix, setCustomSuffix] = useState('.com');
  const [saving,       setSaving]       = useState(false);
  const [removing,     setRemoving]     = useState(false);
  const [verifying,    setVerifying]    = useState(false);
  const [ssl,          setSsl]          = useState(false);
  const [pipelineStep, setPipelineStep] = useState(''); // '', 'linking', 'checking_dns', 'securing_ssl', 'done'
  
  // Detailed domain status fetched from backend
  const [domainInfo,   setDomainInfo]   = useState(null);
  const [infoLoading,  setInfoLoading]  = useState(true);
  
  // Local verification details/messages
  const [dnsStatus,    setDnsStatus]    = useState(null);
  const [message,      setMessage]      = useState('');
  const [error,        setError]        = useState('');
  const [copiedText,   setCopiedText]   = useState('');
  const [mockVerify,   setMockVerify]   = useState(process.env.NODE_ENV === 'development' || true); // Default true for testing convenience

  const parseAndSyncDomainStates = (cd) => {
    if (!cd) return;
    const wildcardSuffix = `.${domain}`;
    if (cd.endsWith(wildcardSuffix)) {
      setDomainPrefix(cd.substring(0, cd.length - wildcardSuffix.length));
      setDomainSuffix(wildcardSuffix);
    } else {
      const common = ['.com', '.net', '.org'];
      let matched = false;
      for (const s of common) {
        if (cd.endsWith(s)) {
          setDomainPrefix(cd.substring(0, cd.length - s.length));
          setDomainSuffix(s);
          matched = true;
          break;
        }
      }
      if (!matched) {
        const lastDot = cd.lastIndexOf('.');
        if (lastDot !== -1) {
          setDomainPrefix(cd.substring(0, lastDot));
          setDomainSuffix('custom');
          setCustomSuffix(cd.substring(lastDot));
        } else {
          setDomainPrefix(cd);
          setDomainSuffix('.com');
        }
      }
    }
  };

  const fetchDomainInfo = async () => {
    try {
      const res = await api.get(`/domains/${project._id}`);
      setDomainInfo(res.data);
      if (res.data.customDomain) {
        parseAndSyncDomainStates(res.data.customDomain);
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

  // ── Auto-poll DNS status every 15s when pending verification ─────────────────
  useEffect(() => {
    const status = domainInfo?.customDomainStatus;
    if (status !== 'pending_dns') return; // Only poll when DNS is pending

    const pollInterval = setInterval(async () => {
      try {
        const isWildcardSelected = domainSuffix === `.${domain}` || (domainInfo?.customDomain && domainInfo.customDomain.endsWith(`.${domain}`));
        const forceMock = mockVerify || isWildcardSelected;
        const url = `/domains/${project._id}/verify${forceMock ? '?mock=true' : ''}`;
        const res = await api.get(url);
        // If DNS is now verified, automatically provision SSL certificate in the background!
        if (res.data.verified) {
          setMessage('✅ DNS record detected! Auto-provisioning SSL certificate...');
          try {
            await api.post(`/domains/${project._id}/ssl`);
            setMessage('✨ DNS verification & SSL provisioning successful! Your domain is secure and active.');
          } catch (sslErr) {
            console.error('[DomainManager] Auto-SSL provisioning failed:', sslErr);
            setMessage('✅ DNS record detected, but SSL auto-provisioning failed. Click "Secure with SSL" to try again.');
          }
          await fetchDomainInfo();
          if (onUpdate) onUpdate();
          clearInterval(pollInterval);
        }
      } catch {
        // Silently ignore poll errors
      }
    }, 15000); // Poll every 15 seconds

    return () => clearInterval(pollInterval);
  }, [domainInfo?.customDomainStatus, project._id, mockVerify, domainSuffix, onUpdate]);

  const subUrl = `https://${project.subdomain}.${domain}`;
  const targetCname = `${project.subdomain}.${domain}`;

  const copyToClipboard = (text, type) => {
    navigator.clipboard.writeText(text);
    setCopiedText(type);
    setTimeout(() => setCopiedText(''), 2000);
  };

  const runAutomatedPipeline = async (targetDomainToLink, forceMock) => {
    setSaving(true); setError(''); setMessage(''); setDnsStatus(null);
    setPipelineStep('linking');
    try {
      // Step 1: Link Custom Domain config
      await api.post(`/domains/${project._id}/custom`, { customDomain: targetDomainToLink });
      await fetchDomainInfo();
      if (onUpdate) onUpdate();
      
      // Step 2: CNAME / DNS propagation checks
      setPipelineStep('checking_dns');
      const url = `/domains/${project._id}/verify${forceMock ? '?mock=true' : ''}`;
      const res = await api.get(url);
      setDnsStatus(res.data);
      
      if (!res.data.verified) {
        throw new Error(`DNS Check failed: Your domain resolves to "${res.data.resolvedTo}" instead of "${res.data.targetCname}".`);
      }
      await fetchDomainInfo();
      if (onUpdate) onUpdate();
      
      // Step 3: Secure with SSL (Let's Encrypt)
      setPipelineStep('securing_ssl');
      await api.post(`/domains/${project._id}/ssl`);
      
      // Complete!
      setPipelineStep('done');
      setMessage('✨ DNS verification & SSL provisioning successful! Your domain is secure and active.');
      await fetchDomainInfo();
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Domain setup automation failed');
      setPipelineStep('');
    } finally {
      setSaving(false);
    }
  };

  const handleLinkAutomatedDomain = () => {
    const prefix = domainPrefix.trim();
    if (!prefix) {
      setError('Please enter a domain prefix.');
      return;
    }

    let suffix = domainSuffix;
    if (suffix === 'custom') {
      suffix = customSuffix.trim();
      if (!suffix) {
        setError('Please enter a custom suffix.');
        return;
      }
      if (!suffix.startsWith('.')) {
        suffix = '.' + suffix;
      }
    }

    const domainToLink = `${prefix}${suffix}`.toLowerCase();
    const isWildcard = suffix === `.${domain}`;
    const forceMock = mockVerify || isWildcard;

    runAutomatedPipeline(domainToLink, forceMock);
  };

  const handleRemoveDomain = async () => {
    if (!window.confirm('Are you sure you want to remove this custom domain? This will reset your SSL configuration.')) return;
    setRemoving(true); setError(''); setMessage(''); setDnsStatus(null);
    try {
      const res = await api.delete(`/domains/${project._id}/custom`);
      setMessage(res.data.message);
      setDomainPrefix(project.subdomain || '');
      setDomainSuffix(`.${domain}`);
      setCustomSuffix('.com');
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
      const isWildcardSelected = domainSuffix === `.${domain}` || (domainInfo?.customDomain && domainInfo.customDomain.endsWith(`.${domain}`));
      const forceMock = mockVerify || isWildcardSelected;
      const url = `/domains/${project._id}/verify${forceMock ? '?mock=true' : ''}`;
      const res = await api.get(url);
      setDnsStatus(res.data);

      if (res.data.verified) {
        setMessage('✨ DNS verification successful! Auto-provisioning SSL certificate...');
        try {
          await api.post(`/domains/${project._id}/ssl`);
          setMessage('✨ DNS verification & SSL provisioning successful! Your domain is secure and active.');
        } catch (sslErr) {
          console.error('[DomainManager] Auto-SSL provisioning failed:', sslErr);
          setMessage('✅ DNS verification successful, but SSL auto-provisioning failed. Click "Secure with SSL" to try again.');
        }
      } else {
        setError(`DNS Check failed: Your domain resolves to "${res.data.resolvedTo}" instead of "${res.data.targetCname}".`);
      }
      await fetchDomainInfo();
      if (onUpdate) onUpdate();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to verify DNS');
    } finally { setVerifying(false); }
  };

  // Trigger automatic DNS verification check on mount if pending
  useEffect(() => {
    if (domainInfo && domainInfo.customDomainStatus === 'pending_dns' && !verifying && !dnsStatus) {
      handleVerifyDNS();
    }
  }, [domainInfo?.customDomainStatus, project._id]);

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

  const handleSwitchToInstantWildcard = () => {
    const defaultPrefix = project.subdomain || '';
    const targetWildcardSuffix = `.${domain}`;
    setDomainPrefix(defaultPrefix);
    setDomainSuffix(targetWildcardSuffix);
    setMockVerify(true);

    runAutomatedPipeline(`${defaultPrefix}${targetWildcardSuffix}`, true);
  };

  // Determine current overall state for styling
  const activeDomain = domainInfo?.customDomain;
  const domainStatus = domainInfo?.customDomainStatus || 'none'; // 'none', 'pending_dns', 'dns_verified', 'active', 'failed'
  const sslStatus = domainInfo?.sslStatus || 'none'; // 'none', 'pending', 'active', 'failed'
  const isFullyActive = activeDomain && domainStatus === 'active' && sslStatus === 'active';
  
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

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 28, alignItems: 'start' }}>
            
            {/* 1. Custom Domain Management Card */}
            <div className="lp-card glass" style={{ padding: 26, border: '1px solid rgba(255, 255, 255, 0.08)', display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                   <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-primary)" strokeWidth="2.5"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
                   <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Domain Setup</h3>
                </div>
                <p className="text-muted" style={{ fontSize: 13, lineHeight: '1.5', marginBottom: 20 }}>
                  Route web traffic from your own DNS provider to this project container by attaching a custom domain.
                </p>

                {!isFullyActive ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginBottom: 20 }}>
                    {activeDomain && (
                      <div style={{ padding: '10px 14px', borderRadius: 8, background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          Current: <code style={{ color: 'var(--accent-danger)', fontWeight: 600 }}>{activeDomain}</code> (Failed/Pending SSL)
                        </span>
                        <button onClick={handleRemoveDomain} disabled={removing} style={{ background: 'transparent', border: 'none', color: 'var(--accent-danger)', cursor: 'pointer', fontSize: 12, textDecoration: 'underline' }}>
                          {removing ? 'Unlinking...' : 'Unlink'}
                        </button>
                      </div>
                    )}
                    
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Subdomain Prefix</span>
                        <input
                          value={domainPrefix}
                          onChange={(e) => {
                            const val = e.target.value.toLowerCase();
                            if (val.includes('.') && val.length > 3) {
                              const wildcardSuffix = `.${domain}`;
                              if (val.endsWith(wildcardSuffix)) {
                                setDomainPrefix(val.substring(0, val.length - wildcardSuffix.length).replace(/[^a-z0-9-]/g, ''));
                                setDomainSuffix(wildcardSuffix);
                                setMockVerify(true);
                              } else {
                                const common = ['.com', '.net', '.org'];
                                let matched = false;
                                for (const s of common) {
                                  if (val.endsWith(s)) {
                                    setDomainPrefix(val.substring(0, val.length - s.length).replace(/[^a-z0-9-]/g, ''));
                                    setDomainSuffix(s);
                                    matched = true;
                                    break;
                                  }
                                }
                                if (!matched) {
                                  const lastDot = val.lastIndexOf('.');
                                  setDomainPrefix(val.substring(0, lastDot).replace(/[^a-z0-9-]/g, ''));
                                  setDomainSuffix('custom');
                                  setCustomSuffix(val.substring(lastDot));
                                }
                              }
                            } else {
                              setDomainPrefix(val.replace(/[^a-z0-9-]/g, ''));
                            }
                          }}
                          placeholder="e.g. netflixbymohan"
                          className="lp-search"
                          style={{ width: '100%', backgroundImage: 'none', paddingLeft: 14, borderRadius: 8, fontSize: 13, height: 42, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)' }}
                        />
                      </div>
                      <div style={{ flex: 1.5, display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Extension / Suffix</span>
                        <div style={{ position: 'relative' }}>
                          <select
                            value={domainSuffix}
                            onChange={(e) => {
                              const val = e.target.value;
                              setDomainSuffix(val);
                              if (val === `.${domain}`) {
                                setMockVerify(true);
                              }
                            }}
                            className="lp-input"
                            style={{ 
                              width: '100%', 
                              padding: '0 32px 0 14px', 
                              borderRadius: 8, 
                              fontSize: 13, 
                              height: 42, 
                              background: 'rgba(255,255,255,0.03)', 
                              border: '1px solid rgba(255,255,255,0.1)', 
                              color: 'var(--text-main)', 
                              cursor: 'pointer', 
                              outline: 'none',
                              appearance: 'none',
                              WebkitAppearance: 'none',
                              MozAppearance: 'none',
                              transition: 'all 0.2s'
                            }}
                            onMouseOver={(e) => { e.target.style.background = 'rgba(255,255,255,0.06)'; e.target.style.borderColor = 'var(--accent-primary)'; }}
                            onMouseOut={(e) => { e.target.style.background = 'rgba(255,255,255,0.03)'; e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                          >
                            <option value={`.${domain}`} style={{ background: '#181227', color: '#fff' }}>.{domain} (Free)</option>
                            <option value=".com" style={{ background: '#181227', color: '#fff' }}>.com</option>
                            <option value=".net" style={{ background: '#181227', color: '#fff' }}>.net</option>
                            <option value=".org" style={{ background: '#181227', color: '#fff' }}>.org</option>
                            <option value="custom" style={{ background: '#181227', color: '#fff' }}>Custom Suffix...</option>
                          </select>
                          <div style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', color: 'var(--text-muted)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                          </div>
                        </div>
                      </div>
                    </div>

                    {domainSuffix === 'custom' && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase' }}>Custom Suffix</span>
                        <input
                          value={customSuffix}
                          onChange={(e) => setCustomSuffix(e.target.value.toLowerCase().replace(/[^a-z0-9.-]/g, ''))}
                          placeholder="e.g. .co.uk"
                          className="lp-search"
                          style={{ width: '100%', backgroundImage: 'none', paddingLeft: 14, borderRadius: 8, fontSize: 13, height: 42, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-main)' }}
                        />
                      </div>
                    )}

                    {domainSuffix !== `.${domain}` && (
                      <div style={{ padding: '8px 12px', borderRadius: 6, background: 'rgba(245, 158, 11, 0.08)', border: '1px solid rgba(245, 158, 11, 0.2)', fontSize: 11, color: '#f59e0b', lineHeight: 1.4 }}>
                        ⚠️ Suffixes like <strong>{domainSuffix === 'custom' ? customSuffix : domainSuffix}</strong> require manual DNS CNAME record configuration. For a 100% automated instant setup, choose the <strong>.{domain}</strong> option.
                      </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6, background: 'rgba(255, 255, 255, 0.02)', padding: '10px 14px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.04)' }}>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Compiled Domain: <strong style={{ color: 'var(--accent-primary)', fontSize: 13 }}>{domainPrefix || 'myapp'}{domainSuffix === 'custom' ? (customSuffix.startsWith('.') ? customSuffix : '.' + customSuffix) : domainSuffix}</strong>
                      </span>
                      <button onClick={handleLinkAutomatedDomain} disabled={saving} className="lp-btn-primary" style={{ padding: '0 20px', borderRadius: 8, fontSize: 13, height: 38, fontWeight: 600 }}>
                        {saving ? 'Linking...' : activeDomain ? 'Update & Automate' : 'Link & Automate'}
                      </button>
                    </div>

                    {activeDomain && activeDomain !== `${project.subdomain}.${domain}` && (
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 12, marginTop: 4 }}>
                        <button onClick={handleSwitchToInstantWildcard} disabled={saving} className="lp-btn-primary" style={{ width: '100%', height: 38, background: 'linear-gradient(135deg, #a855f7 0%, #3b82f6 100%)', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          {saving ? 'Switching...' : '✨ Switch to Free & Instant Wildcard Domain'}
                        </button>
                      </div>
                    )}

                    {pipelineStep && (
                      <div className="glass fade-in" style={{ padding: '14px 20px', borderRadius: 10, border: '1px solid rgba(168, 85, 247, 0.2)', background: 'rgba(168, 85, 247, 0.02)', display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-main)' }}>
                            {pipelineStep === 'linking' && '🔗 Connecting Domain...'}
                            {pipelineStep === 'checking_dns' && '🔍 Checking DNS records...'}
                            {pipelineStep === 'securing_ssl' && '🔒 Securing SSL Certificate...'}
                            {pipelineStep === 'done' && '✨ Fully Configured & Automated!'}
                          </span>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', background: 'rgba(56, 189, 248, 0.1)', padding: '2px 8px', borderRadius: 4 }}>
                            {pipelineStep === 'linking' && '33%'}
                            {pipelineStep === 'checking_dns' && '66%'}
                            {pipelineStep === 'securing_ssl' && '90%'}
                            {pipelineStep === 'done' && '100%'}
                          </span>
                        </div>
                        <div style={{ width: '100%', height: 4, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{
                            width: pipelineStep === 'linking' ? '33%' : pipelineStep === 'checking_dns' ? '66%' : pipelineStep === 'securing_ssl' ? '90%' : '100%',
                            height: '100%',
                            background: 'linear-gradient(90deg, var(--accent-primary) 0%, var(--accent-success) 100%)',
                            transition: 'width 0.4s ease-in-out',
                            boxShadow: '0 0 8px var(--accent-primary)'
                          }} />
                        </div>
                      </div>
                    )}
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

                      {!(domainSuffix === `.${domain}` || (activeDomain && activeDomain.endsWith(`.${domain}`))) && (
                        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', cursor: 'pointer', marginTop: 4 }}>
                          <input
                            type="checkbox"
                            checked={mockVerify}
                            onChange={(e) => {
                              setMockVerify(e.target.checked);
                              if (e.target.checked && domainStatus === 'pending_dns') {
                                setTimeout(() => handleVerifyDNS(), 100);
                              }
                            }}
                            style={{ accentColor: 'var(--accent-primary)' }}
                          />
                          <span>Mock DNS verification (Useful for testing without live DNS records)</span>
                        </label>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* DNS Resolution Mismatch Alert Panel */}
            {dnsStatus && !dnsStatus.verified && (
              <div className="lp-card glass animate-fade-in" style={{ padding: '20px 24px', border: '1px solid rgba(239, 68, 68, 0.25)', background: 'rgba(239, 68, 68, 0.02)', gridColumn: 'span 2', display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444', fontSize: 14, fontWeight: 700 }}>
                  <span>⚠️</span> DNS Resolution Mismatch Detected
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 6, fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Expected Value (CNAME / IP)</div>
                    <code style={{ color: '#10b981', wordBreak: 'break-all', fontWeight: 700, fontSize: 12 }}>{dnsStatus.targetCname}</code>
                  </div>
                  <div style={{ padding: '12px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.01)', border: '1px solid rgba(255,255,255,0.04)' }}>
                    <div style={{ color: 'var(--text-muted)', marginBottom: 6, fontSize: 10, textTransform: 'uppercase', fontWeight: 600 }}>Current DNS Resolution</div>
                    <code style={{ color: '#ef4444', wordBreak: 'break-all', fontWeight: 700, fontSize: 12 }}>{dnsStatus.resolvedTo || 'Unresolved'}</code>
                  </div>
                </div>
                <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  The DNS check resolved your domain to the current mismatch values. Verify that your DNS host has resolved the old values and set the new ones correctly.
                </p>
              </div>
            )}

            {/* 2. DNS Target Instructions Card */}
            <div className="lp-card glass" style={{ padding: 26, border: '1px solid rgba(255, 255, 255, 0.08)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                 <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent-success)" strokeWidth="2.5"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path><line x1="4" y1="22" x2="4" y2="15"></line></svg>
                 <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>DNS Record Config</h3>
              </div>
              
              {(domainSuffix === `.${domain}` || (activeDomain && activeDomain.endsWith(`.${domain}`))) ? (
                <div style={{ padding: '16px 20px', borderRadius: 12, background: 'rgba(16, 185, 129, 0.04)', border: '1px solid rgba(16, 185, 129, 0.15)', height: 'calc(100% - 46px)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#10b981', fontWeight: 700, fontSize: 14, marginBottom: 8 }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                    Fully Automated Suffix
                  </div>
                  <p style={{ margin: 0, fontSize: 13, lineHeight: '1.6', color: 'var(--text-muted)' }}>
                    No manual CNAME setup is required. The <code>.{domain}</code> wildcard instantly maps directly to your deployment environment.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-muted" style={{ fontSize: 13, lineHeight: '1.5', marginBottom: 14 }}>
                    Configure one of the following DNS records at your registrar (e.g., GoDaddy, Cloudflare, Namecheap):
                  </p>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={{ overflowX: 'auto' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(0, 0, 0, 0.2)', border: '1px solid rgba(255, 255, 255, 0.06)', borderRadius: 8, overflow: 'hidden', fontSize: 12 }}>
                        <thead>
                          <tr style={{ background: 'rgba(255, 255, 255, 0.03)', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', color: 'var(--text-muted)', textAlign: 'left' }}>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Type</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Name</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>Value</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600 }}>TTL</th>
                            <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'center' }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr style={{ borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                            <td style={{ padding: '12px', fontWeight: 700, color: 'var(--accent-primary)' }}>CNAME</td>
                            <td style={{ padding: '12px' }}><code>www</code> (or subdomain)</td>
                            <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-main)', wordBreak: 'break-all' }}>{targetCname}</td>
                            <td style={{ padding: '12px', color: 'var(--text-dim)' }}>1 Hour</td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <button onClick={() => copyToClipboard(targetCname, 'value-cname')} style={{ background: 'rgba(56, 189, 248, 0.1)', border: '1px solid rgba(56, 189, 248, 0.2)', color: copiedText === 'value-cname' ? '#10b981' : 'var(--accent-primary)', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, transition: 'all 0.2s' }}>
                                {copiedText === 'value-cname' ? 'Copied' : 'Copy'}
                              </button>
                            </td>
                          </tr>
                          <tr>
                            <td style={{ padding: '12px', fontWeight: 700, color: '#10b981' }}>A</td>
                            <td style={{ padding: '12px' }}><code>@</code> (Apex / Root)</td>
                            <td style={{ padding: '12px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-main)' }}>129.159.22.142</td>
                            <td style={{ padding: '12px', color: 'var(--text-dim)' }}>1 Hour</td>
                            <td style={{ padding: '12px', textAlign: 'center' }}>
                              <button onClick={() => copyToClipboard('129.159.22.142', 'value-ip')} style={{ background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.2)', color: copiedText === 'value-ip' ? '#10b981' : '#10b981', cursor: 'pointer', padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, transition: 'all 0.2s' }}>
                                {copiedText === 'value-ip' ? 'Copied' : 'Copy'}
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}
            </div>

            {domainSuffix !== `.${domain}` && (
              <div className="lp-card glass" style={{ padding: 22, border: '1px solid rgba(245, 158, 11, 0.15)', background: 'rgba(245, 158, 11, 0.02)', marginTop: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12, color: '#f59e0b', fontSize: 14, fontWeight: 700 }}>
                  <span>ℹ️</span> DNS Propagation & Troubleshooting
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: 6, lineHeight: 1.5 }}>
                  <li>DNS records can take up to <strong>24-48 hours</strong> to propagate globally, though they usually update within an hour.</li>
                  <li>Verify your setup with a public lookup tool: <a href={`https://dnschecker.org/#CNAME/${domainPrefix}${domainSuffix === 'custom' ? (customSuffix.startsWith('.') ? customSuffix.substring(1) : customSuffix) : domainSuffix}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-primary)', textDecoration: 'underline', fontWeight: 600 }}>Check DNS Propagation on DNSChecker</a></li>
                  <li>Ensure no conflicting records exist (e.g., duplicate CNAME/A records or old GoDaddy parking page records).</li>
                </ul>
              </div>
            )}
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
                    <h5 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, color: 'var(--text-main)' }}>Step 1: Domain Connected to LaunchLive</h5>
                    <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>Successfully associated the domain <code style={{ color: 'var(--accent-primary)' }}>{activeDomain}</code> with your deployment configuration.</p>
                  </div>
                </div>

                {/* Step 2: CNAME Records */}
                <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', position: 'relative' }}>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '#10b981' : (pipelineStep === 'checking_dns' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)'),
                    border: (domainStatus === 'dns_verified' || domainStatus === 'active') ? 'none' : (pipelineStep === 'checking_dns' ? '2px solid var(--accent-primary)' : '2px solid rgba(255,255,255,0.1)'),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '0 0 10px rgba(16, 185, 129, 0.3)' : 'none',
                    zIndex: 2,
                    fontSize: 12,
                    color: (domainStatus === 'dns_verified' || domainStatus === 'active') ? '#fff' : (pipelineStep === 'checking_dns' ? 'var(--accent-primary)' : 'var(--text-muted)'),
                    animation: (pipelineStep === 'checking_dns') ? 'pulse-purple 1.5s infinite' : 'none'
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
                  <style>{`
                    @keyframes pulse-purple {
                      0% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0.5); }
                      70% { box-shadow: 0 0 0 10px rgba(168, 85, 247, 0); }
                      100% { box-shadow: 0 0 0 0 rgba(168, 85, 247, 0); }
                    }
                  `}</style>
                  <div style={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: sslStatus === 'active' ? '#10b981' : (domainStatus === 'dns_verified' ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)'),
                    border: sslStatus === 'active' ? 'none' : (domainStatus === 'dns_verified' ? '2px solid var(--accent-primary)' : '2px solid rgba(255,255,255,0.1)'),
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: sslStatus === 'active' ? '0 0 10px rgba(16, 185, 129, 0.3)' : 'none',
                    zIndex: 2,
                    fontSize: 12,
                    color: sslStatus === 'active' ? '#fff' : (domainStatus === 'dns_verified' ? 'var(--accent-primary)' : 'var(--text-muted)'),
                    animation: (domainStatus === 'dns_verified' && sslStatus !== 'active') ? 'pulse-purple 1.5s infinite' : 'none'
                  }}>
                    {sslStatus === 'active' ? '✓' : '4'}
                  </div>
                  <div>
                    <h5 style={{ margin: '0 0 4px 0', fontSize: 14, fontWeight: 700, color: sslStatus === 'active' ? 'var(--text-main)' : 'var(--text-muted)' }}>
                      Step 4: SSL Certificate Routing Activation
                      {domainStatus === 'dns_verified' && sslStatus !== 'active' && (
                        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-primary)', marginLeft: 8, fontStyle: 'italic' }}>
                          (Securing...)
                        </span>
                      )}
                    </h5>
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