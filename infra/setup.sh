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
if ! grep -q "DOCKER_BUILDKIT" /etc/environment; then
  echo "DOCKER_BUILDKIT=1" | sudo tee -a /etc/environment
fi
export DOCKER_BUILDKIT=1

# Install Nginx
echo "[4/10] Installing Nginx..."
sudo apt install -y nginx
sudo systemctl enable nginx
sudo systemctl start nginx

# Create launchpad-nginx directory
mkdir -p /home/ubuntu/launchpad-nginx
sudo chown -R ubuntu:ubuntu /home/ubuntu/launchpad-nginx

# Include launchpad-nginx in main nginx.conf
if ! grep -q "launchpad-nginx" /etc/nginx/nginx.conf; then
  sudo sed -i '/http {/a \    include /home/ubuntu/launchpad-nginx/*.conf;' /etc/nginx/nginx.conf
fi

# Install Redis
echo "[5/10] Installing Redis..."
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
sudo systemctl restart redis-server

# Install Git
echo "[6/10] Installing Git..."
sudo apt install -y git

# Install Certbot for SSL
echo "[7/10] Installing Certbot..."
sudo apt install -y certbot python3-certbot-nginx

# Install PM2 for process management
echo "[8/10] Installing PM2..."
sudo npm install -g pm2

# Configure passwordless sudo for Nginx and Certbot
echo "ubuntu ALL=(ALL) NOPASSWD: /usr/sbin/nginx, /usr/bin/certbot" | sudo tee /etc/sudoers.d/launchpad
sudo chmod 0440 /etc/sudoers.d/launchpad

# Certbot auto-renewal cron (weekly)
(crontab -l 2>/dev/null; echo "0 3 * * 1 /usr/bin/certbot renew --post-hook 'systemctl reload nginx' > /dev/null 2>&1") | crontab -

# PM2 startup on reboot and log rotation
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u ubuntu --hp /home/ubuntu
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# Create app directory
echo "[9/10] Creating app directory..."
mkdir -p /home/ubuntu/launchpad/logs
mkdir -p /home/ubuntu/launchpad/repos

# Configure Nginx base
echo "[10/10] Configuring Nginx..."
sudo tee /etc/nginx/sites-available/launchpad > /dev/null << 'NGINX'
server {
    listen 80 default_server;
    server_name _;

    client_max_body_size 50M;

    # Socket.io needs special handling
    location /socket.io/ {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 3600s;
    }

    # Everything else → Node.js
    location / {
        proxy_pass         http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade    $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host       $host;
        proxy_set_header   X-Real-IP  $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 120s;
    }
}
NGINX

sudo ln -sf /etc/nginx/sites-available/launchpad /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t && sudo systemctl reload nginx

# Configure UFW firewall
echo "Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw --force enable

echo ""
echo "========================================="
echo "  Setup Complete!"
echo "========================================="
echo ""
echo "Next steps:"
echo "1. Clone your repo: git clone https://github.com/mohanvel026/launchpad.git /home/ubuntu/launchpad"
echo "2. cd /home/ubuntu/launchpad/server && npm install --production"
echo "3. Create /home/ubuntu/launchpad/server/.env with your values"
echo "4. cd /home/ubuntu/launchpad/client && npm install && npm run build"
echo "5. pm2 start /home/ubuntu/launchpad/infra/ecosystem.config.js"
echo "6. pm2 startup && pm2 save"
echo "7. sudo cp /home/ubuntu/launchpad/infra/launchpad.nginx.conf /etc/nginx/sites-available/launchpad"
echo "8. sudo ln -sf /etc/nginx/sites-available/launchpad /etc/nginx/sites-enabled/"
echo "9. sudo rm -f /etc/nginx/sites-enabled/default"
echo "10. sudo nginx -t && sudo systemctl reload nginx"
echo "11. sudo certbot --nginx -d launchlive.in -d www.launchlive.in"
echo ""
echo "Docker version: $(docker --version 2>/dev/null || echo 'not installed yet')"
echo "Node version:   $(node --version 2>/dev/null || echo 'not installed yet')"