#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# LaunchPad — Cloudflare Tunnel Setup Script
# Run this on your OCI server (Ubuntu) to get a free professional domain
# ─────────────────────────────────────────────────────────────────────────────

echo "📦 Installing cloudflared..."
wget -q https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb
sudo dpkg -i cloudflared-linux-amd64.deb

echo ""
echo "🔐 Login to Cloudflare (a browser link will open)..."
echo "   → Go to cloudflare.com, create a FREE account if you haven't"
echo "   → Then come back here and open the URL shown below"
cloudflared tunnel login

echo ""
echo "🚇 Creating tunnel named 'launchpad'..."
cloudflared tunnel create launchpad

# Get the tunnel ID
TUNNEL_ID=$(cloudflared tunnel list | grep launchpad | awk '{print $1}')
echo "   Tunnel ID: $TUNNEL_ID"

echo ""
echo "📝 Creating tunnel config..."
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: $TUNNEL_ID
credentials-file: /root/.cloudflared/$TUNNEL_ID.json

ingress:
  # Main LaunchPad dashboard
  - hostname: launchpad.YOUR-DOMAIN.com
    service: http://localhost:5000

  # Wildcard: all project subdomains → LaunchPad proxy
  - hostname: "*.launchpad.YOUR-DOMAIN.com"
    service: http://localhost:5000

  # Catch-all (required)
  - service: http_status:404
EOF

echo ""
echo "✅ Done! Next steps:"
echo "   1. Edit ~/.cloudflared/config.yml and replace YOUR-DOMAIN.com"
echo "   2. Add DNS records in Cloudflare dashboard:"
echo "      CNAME  launchpad         → $TUNNEL_ID.cfargotunnel.com"
echo "      CNAME  *.launchpad       → $TUNNEL_ID.cfargotunnel.com"
echo "   3. Run: cloudflared tunnel run launchpad"
echo "   4. Install as service: sudo cloudflared service install"
