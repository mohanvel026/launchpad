#!/bin/bash
# LaunchPad - Oracle Cloud Ubuntu Setup Script
# Run this on your fresh Oracle Cloud Ubuntu 22.04 VM
# Usage: bash setup.sh

set -e

echo "========================================="
echo "  LaunchPad - Oracle Cloud Setup"
echo "========================================="

# Update system
echo "[1/10] Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install Node.js 20
echo "[2/10] Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Docker
echo "[3/10] Installing Docker..."
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
newgrp docker

# Install Nginx
echo "[4/10] Installing Nginx..."
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Install Redis
echo "[5/10] Installing Redis..."
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server

# Install Git
echo "[6/10] Installing Git..."
sudo apt install -y git

# Install Certbot for SSL
echo "[7/10] Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# Install PM2 for process management
echo "[8/10] Installing PM2..."
sudo npm install -g pm2

# Create app directory
echo "[9/10] Creating app directory..."
sudo mkdir -p /var/launchpad
sudo chown -R $USER:$USER /var/launchpad

# Create repos directory for cloned user apps
mkdir -p /var/launchpad/repos

# Configure Nginx base
echo "[10/10] Configuring Nginx..."
sudo tee /etc/nginx/sites-available/launchpad > /dev/null << 'NGINX'
server {
    listen 80;
    server_name _;

    # LaunchPad API
    location /api {
        proxy_pass http://localhost:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_cache_bypass $http_upgrade;
    }

    # LaunchPad Frontend
    location / {
        root /var/launchpad/client/dist;
        try_files $uri $uri/ /index.html;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/launchpad /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Clone your repo: git clone <your-repo-url> /var/launchpad"
echo "2. cd /var/launchpad/server && npm install"
echo "3. Create /var/launchpad/server/.env with your values"
echo "4. cd /var/launchpad/client && npm install && npm run build"
echo "5. pm2 start /var/launchpad/server/server.js --name launchpad"
echo "6. pm2 startup && pm2 save"
echo ""
echo "Docker version: $(docker --version)"
echo "Node version:   $(node --version)"
echo "Redis status:   $(redis-cli ping)"