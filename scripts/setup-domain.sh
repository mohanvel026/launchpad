#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
# LaunchPad — Complete Free Domain + Wildcard Subdomain Setup
# Run this on your OCI Ubuntu server after picking your domain
# ═══════════════════════════════════════════════════════════════════════════════
#
# SUPPORTED FREE DOMAINS (pick one):
#   Option A: Dynu.com           → launchpad.ddnsfree.com (instant, free) [RECOMMENDED - Supports Wildcards]
#   Option B: desec.io           → launchpad.dedyn.io (instant, free)     [RECOMMENDED - Supports Wildcards]
#   Option C: DuckDNS            → launchpad.duckdns.org (instant, free)  [WARNING: Does NOT support wildcard DNS natively]
#   Option D: Your own domain    → anything.com                           [Supports Wildcards via DNS provider]
#
# WHAT THIS SCRIPT DOES:
#   1. Creates nginx wildcard catch-all config
#   2. Gets free wildcard SSL via Let's Encrypt
#   3. Updates LaunchPad .env with new domain
# ═══════════════════════════════════════════════════════════════════════════════

set -e

# ─── CONFIGURE THIS ───────────────────────────────────────────────────────────
YOUR_DOMAIN="launchpad.ddnsfree.com"   # ← change this to your domain (e.g. from Dynu)
YOUR_EMAIL="your@email.com"            # ← change this for SSL cert alerts
YOUR_IP="129.159.22.142"              # ← your OCI server IP
# ─────────────────────────────────────────────────────────────────────────────

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   LaunchPad — Wildcard Domain Setup                          ║"
echo "║   Domain: ${YOUR_DOMAIN}                                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""

# ── STEP 1: Install Certbot ───────────────────────────────────────────────────
echo "📦 Installing certbot..."
sudo apt-get update -q
sudo apt-get install -y certbot python3-certbot-nginx

# ── STEP 2: Write nginx WILDCARD catch-all config ────────────────────────────
echo "📝 Writing nginx wildcard config..."
sudo tee /etc/nginx/sites-available/launchpad-wildcard.conf > /dev/null << EOF
# ── LaunchPad Root Dashboard ─────────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name ${YOUR_DOMAIN};

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
    }
}

# ── Project Subdomains Wildcard ────────────────────────────────────────────────
# ALL subdomains like myapp.${YOUR_DOMAIN} are routed to
# the LaunchPad Node.js proxy (port 5000) which handles routing to containers.
server {
    listen 80;
    listen [::]:80;
    server_name *.${YOUR_DOMAIN};

    location /healthz {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
        client_max_body_size 50m;
    }
}
EOF

# Enable the config
sudo ln -sf /etc/nginx/sites-available/launchpad-wildcard.conf \
             /etc/nginx/sites-enabled/launchpad-wildcard.conf

# Test and reload nginx
sudo nginx -t && sudo nginx -s reload
echo "✅ nginx wildcard config active"

# ── STEP 3: Get FREE SSL cert ─────────────────────────────────────────────────
echo ""
echo "🔐 Getting FREE wildcard SSL certificate from Let's Encrypt..."
echo "   (This needs DNS verification — you'll need to add a TXT record)"
echo ""

# For wildcard SSL, certbot needs DNS challenge
# This works automatically if you have Cloudflare API token
# Otherwise, it will prompt you to add a TXT record manually

sudo certbot certonly \
  --manual \
  --preferred-challenges dns \
  --agree-tos \
  --email "${YOUR_EMAIL}" \
  -d "${YOUR_DOMAIN}" \
  -d "*.${YOUR_DOMAIN}"

# After cert is issued, update nginx to use HTTPS
sudo tee /etc/nginx/sites-available/launchpad-wildcard.conf > /dev/null << EOF
# ── HTTP → HTTPS Redirect ──────────────────────────────────────────────────────
server {
    listen 80;
    listen [::]:80;
    server_name ${YOUR_DOMAIN} *.${YOUR_DOMAIN};
    return 301 https://\$host\$request_uri;
}

# ── LaunchPad Root (HTTPS) ──────────────────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${YOUR_DOMAIN};

    ssl_certificate     /etc/letsencrypt/live/${YOUR_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${YOUR_DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options SAMEORIGIN always;

    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_read_timeout 120s;
    }
}

# ── Project Subdomains (HTTPS Wildcard) ────────────────────────────────────────
server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name *.${YOUR_DOMAIN};

    # Wildcard cert covers ALL subdomains
    ssl_certificate     /etc/letsencrypt/live/${YOUR_DOMAIN}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${YOUR_DOMAIN}/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;

    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;

    location /healthz {
        return 200 'ok';
        add_header Content-Type text/plain;
    }

    location / {
        # All subdomain traffic → LaunchPad proxy (port 5000)
        # LaunchPad reads the Host header and routes to the right container
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade \$http_upgrade;
        proxy_set_header   Connection 'upgrade';
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto https;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 120s;
        client_max_body_size 50m;
    }
}
EOF

sudo nginx -t && sudo nginx -s reload
echo "✅ HTTPS nginx config active"

# ── STEP 4: Update LaunchPad .env ─────────────────────────────────────────────
echo ""
echo "📝 Updating LaunchPad environment..."

ENV_FILE="/home/ubuntu/launchpad/server/.env"
if [ -f "$ENV_FILE" ]; then
  # Update CLOUDFLARE_DOMAIN
  sed -i "s|^CLOUDFLARE_DOMAIN=.*|CLOUDFLARE_DOMAIN=${YOUR_DOMAIN}|" "$ENV_FILE"
  echo "✅ Updated CLOUDFLARE_DOMAIN in .env"
else
  echo "⚠️  Could not find .env at ${ENV_FILE}"
  echo "   Manually set: CLOUDFLARE_DOMAIN=${YOUR_DOMAIN}"
fi

# ── STEP 5: Auto-renew SSL cert ───────────────────────────────────────────────
echo ""
echo "🔄 Setting up SSL auto-renewal..."
(crontab -l 2>/dev/null; echo "0 12 * * * /usr/bin/certbot renew --quiet && nginx -s reload") | crontab -
echo "✅ SSL auto-renewal scheduled"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅ SETUP COMPLETE!                                          ║"
echo "║                                                              ║"
echo "║  Platform:   https://${YOUR_DOMAIN}                         ║"
echo "║  Projects:   https://myapp.${YOUR_DOMAIN}                   ║"
echo "║              https://stockflow.${YOUR_DOMAIN}               ║"
echo "║                                                              ║"
echo "║  Restart LaunchPad server to apply domain changes:          ║"
echo "║    pm2 restart launchpad                                     ║"
echo "╚══════════════════════════════════════════════════════════════╝"
