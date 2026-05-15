const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

// LaunchPad writes configs here — ubuntu user owns this dir, NO sudo needed for the write.
// The main nginx.conf includes this via:  include /home/ubuntu/launchpad-nginx/*.conf;
const LP_NGINX_DIR = process.env.LP_NGINX_DIR   || '/home/ubuntu/launchpad-nginx';
const NGINX_SITES  = process.env.NGINX_SITES_DIR || '/etc/nginx/sites-enabled';
const DOMAIN       = process.env.CLOUDFLARE_DOMAIN || '129.159.22.142.nip.io';

// Create the launchpad-nginx dir on module load (ubuntu user owns ~/launchpad-nginx)
try {
  if (!fs.existsSync(LP_NGINX_DIR)) fs.mkdirSync(LP_NGINX_DIR, { recursive: true });
} catch (e) {
  console.warn('Could not create LP_NGINX_DIR:', e.message);
}

// ─── Templates ────────────────────────────────────────────────────────────────
const httpTemplate = (subdomain, port) => `
server {
    listen 80;
    server_name ${subdomain}.${DOMAIN};

    location /healthz {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    location / {
        proxy_pass         http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
`;

const httpsTemplate = (subdomain, port) => `
server {
    listen 80;
    server_name ${subdomain}.${DOMAIN};
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name ${subdomain}.${DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${subdomain}.${DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${subdomain}.${DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;

    location /healthz {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    location / {
        proxy_pass         http://localhost:${port};
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host $host;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 60s;
    }
}
`;

// ─── Core function ─────────────────────────────────────────────────────────────
const createNginxConfig = (subdomain, port, useSSL = false) => {
  const config  = useSSL ? httpsTemplate(subdomain, port) : httpTemplate(subdomain, port);
  const lpFile  = path.join(LP_NGINX_DIR, `${subdomain}.conf`);
  const sysFile = path.join(NGINX_SITES,  `${subdomain}.conf`);

  // ── 1. Write to LP_NGINX_DIR (ubuntu user owns this — no sudo needed) ──
  try {
    fs.writeFileSync(lpFile, config, 'utf-8');
    console.log(`[nginx] Config saved: ${lpFile}`);
  } catch (writeErr) {
    console.error(`[nginx] FAILED to write ${lpFile}:`, writeErr.message);
    return; // nothing we can do without the config file
  }

  // ── 2. Sync to /etc/nginx/sites-enabled (direct first, sudo fallback) ──
  try {
    fs.writeFileSync(sysFile, config, 'utf-8');
  } catch {
    try {
      execSync(`sudo cp "${lpFile}" "${sysFile}"`, { stdio: 'pipe' });
    } catch (cpErr) {
      console.warn(`[nginx] Could not copy to sites-enabled (will rely on include):`,
        cpErr.message.slice(0, 120));
    }
  }

  // ── 3. Test config then reload nginx ──
  try {
    execSync('sudo nginx -t', { stdio: 'pipe' });
  } catch (testErr) {
    const out = (testErr.stderr || testErr.stdout || Buffer.alloc(0)).toString();
    console.error(`[nginx] Config test FAILED for ${subdomain}:\n${out.slice(0, 400)}`);
    return;
  }

  try {
    execSync('sudo nginx -s reload', { stdio: 'pipe' });
    console.log(`[nginx] Reloaded OK: ${subdomain}.${DOMAIN} -> :${port} (SSL: ${useSSL})`);
  } catch (reloadErr) {
    console.error(`[nginx] Reload failed:`, reloadErr.message.slice(0, 200));
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const upgradeToHTTPS  = (subdomain, port) => createNginxConfig(subdomain, port, true);

const updateNginxPort = (subdomain, newPort) => {
  const useSSL = fs.existsSync(
    `/etc/letsencrypt/live/${subdomain}.${DOMAIN}/fullchain.pem`
  );
  createNginxConfig(subdomain, newPort, useSSL);
};

const removeNginxConfig = (subdomain) => {
  const lpFile  = path.join(LP_NGINX_DIR, `${subdomain}.conf`);
  const sysFile = path.join(NGINX_SITES,  `${subdomain}.conf`);
  try {
    if (fs.existsSync(lpFile))  fs.unlinkSync(lpFile);
    if (fs.existsSync(sysFile)) {
      try   { fs.unlinkSync(sysFile); }
      catch { execSync(`sudo rm -f "${sysFile}"`, { stdio: 'pipe' }); }
    }
    execSync('sudo nginx -s reload', { stdio: 'pipe' });
    console.log(`[nginx] Config removed for ${subdomain}`);
  } catch (err) {
    console.warn('[nginx] Remove error:', err.message.slice(0, 80));
  }
};

module.exports = { createNginxConfig, upgradeToHTTPS, removeNginxConfig, updateNginxPort };