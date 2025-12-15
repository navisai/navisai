#!/bin/bash

# NavisAI nginx configuration script
# Configures nginx to proxy navis.local to the NavisAI daemon

set -e

NGINX_CONF="/etc/nginx/sites-available/navis"
NGINX_ENABLED="/etc/nginx/sites-enabled/navis"
DAEMON_PORT="47621"

echo "🔧 Configuring nginx for NavisAI..."

# Create nginx configuration
sudo tee "$NGINX_CONF" > /dev/null <<EOF
# NavisAI nginx configuration
server {
    listen 443 ssl http2;
    server_name navis.local;

    # SSL configuration
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;

    # Log files
    access_log /var/log/nginx/navis.local.access.log;
    error_log /var/log/nginx/navis.local.error.log;

    # Proxy to NavisAI daemon
    location / {
        proxy_pass https://127.0.0.1:$DAEMON_PORT;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        # SSL verification for upstream
        proxy_ssl_verify off;
        proxy_ssl_session_reuse on;

        # WebSocket support
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}

# HTTP to HTTPS redirect
server {
    listen 80;
    server_name navis.local;
    return 301 https://\$server_name\$request_uri;
}
EOF

# Enable site
sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED"

# Test configuration
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

echo "✅ nginx configured successfully!"
echo "🌐 NavisAI is now available at: https://navis.local"
echo "📱 No port numbers needed - seamless UX!"
