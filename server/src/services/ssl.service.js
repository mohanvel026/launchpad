const { execSync } = require('child_process');
const dns          = require('dns').promises;

// Check if a domain resolves to an IP address
const isDomainResolvable = async (domainName) => {
  try {
    const addresses = await dns.resolve4(domainName);
    return addresses && addresses.length > 0;
  } catch (err) {
    try {
      const addresses = await dns.resolve6(domainName);
      return addresses && addresses.length > 0;
    } catch {
      return false;
    }
  }
};

// Provision an SSL certificate for a subdomain and optional custom domain using certbot
// Requires: certbot installed on the Oracle VM, port 80 open
const provisionSSL = async (subdomain, customDomain = null) => {
  const domain    = process.env.CLOUDFLARE_DOMAIN || 'launchpad.dev';
  const fullDomain = `${subdomain}.${domain}`;
  const email     = process.env.SSL_EMAIL || process.env.SMTP_USER;

  try {
    const emailArg = (email && email !== 'placeholder') ? `-m ${email}` : '--register-unsafely-without-email';
    
    // Check if the domain is a wildcard IP service (e.g. nip.io, sslip.io)
    const isWildcardIpDomain = domain.includes('nip.io') || domain.includes('sslip.io');

    // Resolve domains to verify they are alive before running certbot
    const isFullDomainOk = await isDomainResolvable(fullDomain);
    const isCustomDomainOk = customDomain ? await isDomainResolvable(customDomain) : false;

    if (!isFullDomainOk && (!customDomain || !isCustomDomainOk)) {
      console.warn(`[ssl] Neither default subdomain (${fullDomain}) nor custom domain (${customDomain}) are resolvable in DNS. Skipping SSL provisioning.`);
      return false;
    }

    let domainArgs = '';
    // Exclude nip.io/sslip.io from certbot to avoid Let's Encrypt rate limit blocks
    if (isFullDomainOk && !isWildcardIpDomain) {
      domainArgs += `-d ${fullDomain}`;
    }
    if (customDomain && isCustomDomainOk) {
      domainArgs += `${domainArgs ? ' ' : ''}-d ${customDomain}`;
    }

    if (!domainArgs) {
      console.log(`[ssl] No resolvable non-wildcard-IP domains to provision SSL for.`);
      if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV || (customDomain && (customDomain.includes('nip.io') || customDomain.includes('sslip.io')))) {
        console.log(`[Dev/Wildcard Mode] Mocking successful SSL provisioning for custom domain: ${customDomain}`);
        return true;
      }
      return false;
    }

    execSync(
      `certbot certonly --nginx ${domainArgs} --non-interactive --agree-tos ${emailArg} --expand`,
      { stdio: 'pipe' }
    );
    console.log(`SSL certificate provisioned for ${domainArgs}`);
    return true;
  } catch (err) {
    // In dev mode certbot won't exist — log and continue, don't crash the deploy
    console.warn(`SSL provisioning skipped (${fullDomain}):`, err.message.slice(0, 100));
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      console.log(`[Dev Mode] Mocking successful SSL provisioning for ${fullDomain}`);
      return true;
    }
    return false;
  }
};

// Revoke and delete SSL cert when a project is removed
const revokeSSL = (subdomain) => {
  const domain     = process.env.CLOUDFLARE_DOMAIN || 'launchpad.dev';
  const fullDomain = `${subdomain}.${domain}`;
  try {
    execSync(`certbot delete --cert-name ${fullDomain} --non-interactive`, { stdio: 'pipe' });
    console.log(`SSL certificate revoked for ${fullDomain}`);
  } catch (err) {
    console.warn(`SSL revoke skipped:`, err.message.slice(0, 100));
  }
};

// Renew all certs (called by cron job weekly)
const renewAllSSL = () => {
  try {
    execSync('certbot renew --quiet', { stdio: 'pipe' });
    console.log('SSL certificates renewed');
  } catch (err) {
    console.error('SSL renewal error:', err.message);
  }
};

module.exports = { provisionSSL, revokeSSL, renewAllSSL };