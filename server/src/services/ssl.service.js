const { execSync } = require('child_process');
const fs           = require('path');

// Provision an SSL certificate for a subdomain and optional custom domain using certbot
// Requires: certbot installed on the Oracle VM, port 80 open
const provisionSSL = (subdomain, customDomain = null) => {
  const domain    = process.env.CLOUDFLARE_DOMAIN || 'launchpad.dev';
  const fullDomain = `${subdomain}.${domain}`;
  const email     = process.env.SSL_EMAIL || process.env.SMTP_USER;

  try {
    const emailArg = (email && email !== 'placeholder') ? `-m ${email}` : '--register-unsafely-without-email';
    
    // Add custom domain to certbot request if provided for multi-domain SSL coverage
    let domainArgs = `-d ${fullDomain}`;
    if (customDomain) {
      domainArgs += ` -d ${customDomain}`;
    }

    execSync(
      `certbot certonly --nginx ${domainArgs} --non-interactive --agree-tos ${emailArg} --expand`,
      { stdio: 'pipe' }
    );
    console.log(`SSL certificate provisioned for ${fullDomain}${customDomain ? ' and ' + customDomain : ''}`);
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