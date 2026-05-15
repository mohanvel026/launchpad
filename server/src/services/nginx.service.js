const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

const NGINX_SITES  = process.env.NGINX_SITES_DIR || '/etc/nginx/sites-enabled';
const DOMAIN       = process.env.CLOUDFLARE_DOMAIN || '129.159.22.142.nip.io';

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

const createNginxConfig = (subdomain, port, useSSL = false) => {
  const config   = useSSL ? httpsTemplate(subdomain, port) : httpTemplate(subdomain, port);
  const filePath = path.join(NGINX_SITES, `${subdomain}.conf`);
  const tmpPath  = `/tmp/${subdomain}.conf`;
  try {
    // Write to a temporary file first, then use sudo to move it into place
    fs.writeFileSync(tmpPath, config);
    execSync(`sudo mv ${tmpPath} ${filePath}`, { stdio: 'pipe' });
    execSync('sudo nginx -t && sudo nginx -s reload', { stdio: 'pipe' });
    console.log(`Nginx config written: ${subdomain}.${DOMAIN} -> :${port} (SSL: ${useSSL})`);
  } catch (err) {
    console.warn('Nginx config skipped (dev mode):', err.message.slice(0, 120));
  }
};

const upgradeToHTTPS  = (subdomain, port) => createNginxConfig(subdomain, port, true);
const updateNginxPort = (subdomain, newPort) => {
  const useSSL = fs.existsSync(`/etc/letsencrypt/live/${subdomain}.${DOMAIN}/fullchain.pem`);
  createNginxConfig(subdomain, newPort, useSSL);
};

const removeNginxConfig = (subdomain) => {
  const filePath = path.join(NGINX_SITES, `${subdomain}.conf`);
  try {
    if (fs.existsSync(filePath)) {
      execSync(`sudo rm -f ${filePath}`, { stdio: 'pipe' });
      execSync('sudo nginx -s reload', { stdio: 'pipe' });
    }
  } catch (err) {
    console.warn('Nginx remove skipped:', err.message.slice(0, 80));
  }
};

module.exports = { createNginxConfig, upgradeToHTTPS, removeNginxConfig, updateNginxPort };