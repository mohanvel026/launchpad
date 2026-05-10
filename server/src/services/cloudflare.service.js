const axios = require('axios');

const CF_BASE = 'https://api.cloudflare.com/client/v4';

const cfHeaders = () => ({
  Authorization: `Bearer ${process.env.CLOUDFLARE_API_TOKEN}`,
  'Content-Type': 'application/json',
});

// Create a DNS A record: subdomain.yourdomain.com → your Oracle VM IP
const createSubdomain = async (subdomain) => {
  const zoneId   = process.env.CLOUDFLARE_ZONE_ID;
  const domain   = process.env.CLOUDFLARE_DOMAIN;
  const serverIp = process.env.SERVER_IP;   // your Oracle Cloud VM public IP

  if (!zoneId || !domain || !serverIp) {
    console.warn('Cloudflare env vars missing — skipping DNS creation (dev mode)');
    return null;
  }

  try {
    const res = await axios.post(
      `${CF_BASE}/zones/${zoneId}/dns_records`,
      {
        type:    'A',
        name:    `${subdomain}.${domain}`,
        content: serverIp,
        ttl:     1,       // Auto TTL
        proxied: true,    // Route through Cloudflare CDN
      },
      { headers: cfHeaders() }
    );

    if (!res.data.success) {
      throw new Error(JSON.stringify(res.data.errors));
    }

    console.log(`DNS created: ${subdomain}.${domain} → ${serverIp}`);
    return res.data.result.id;   // DNS record ID for future deletion
  } catch (err) {
    console.error('Cloudflare DNS create error:', err.message);
    return null;
  }
};

// Delete a DNS record when a project is deleted
const deleteSubdomain = async (dnsRecordId) => {
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId || !dnsRecordId) return;

  try {
    await axios.delete(
      `${CF_BASE}/zones/${zoneId}/dns_records/${dnsRecordId}`,
      { headers: cfHeaders() }
    );
    console.log(`DNS record ${dnsRecordId} deleted`);
  } catch (err) {
    console.error('Cloudflare DNS delete error:', err.message);
  }
};

// Add a custom domain CNAME record
const addCustomDomain = async (customDomain, subdomain) => {
  const domain = process.env.CLOUDFLARE_DOMAIN;
  const zoneId = process.env.CLOUDFLARE_ZONE_ID;
  if (!zoneId) return null;

  try {
    const res = await axios.post(
      `${CF_BASE}/zones/${zoneId}/dns_records`,
      {
        type:    'CNAME',
        name:    customDomain,
        content: `${subdomain}.${domain}`,
        ttl:     1,
        proxied: false,   // User manages their own Cloudflare proxy
      },
      { headers: cfHeaders() }
    );
    return res.data.result?.id;
  } catch (err) {
    console.error('Custom domain DNS error:', err.message);
    return null;
  }
};

module.exports = { createSubdomain, deleteSubdomain, addCustomDomain };