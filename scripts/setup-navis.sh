#!/bin/bash
# NavisAI Setup Script
# Configures navis.local resolution and HTTPS access

set -e

echo "🧭 NavisAI Setup Script"
echo "======================="
echo ""

# Check if running with appropriate privileges
if [[ $EUID -ne 0 ]]; then
    echo "⚠️  This script requires sudo privileges to:"
    echo "   - Add navis.local to /etc/hosts"
    echo "   - Configure system resolver (macOS)"
    echo ""
    echo "📝 Running with sudo..."
    exec sudo "$0" "$@"
fi

# Function to detect OS
detect_os() {
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "macos"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "linux"
    else
        echo "unknown"
    fi
}

OS=$(detect_os)
echo "🖥️  Detected OS: $OS"
echo ""

# Add navis.local to hosts file
setup_hosts() {
    echo "📝 Configuring /etc/hosts..."

    # Check if entry already exists
    if grep -q "navis.local" /etc/hosts; then
        echo "✅ navis.local already exists in /etc/hosts"
    else
        echo "# Added by NavisAI" >> /etc/hosts
        echo "127.0.0.1 navis.local" >> /etc/hosts
        echo "✅ Added navis.local to /etc/hosts"
    fi
}

# Configure macOS resolver
setup_resolver() {
    if [[ "$OS" == "macos" ]]; then
        echo "🔍 Configuring macOS resolver..."

        RESOLVER_DIR="/etc/resolver"
        RESOLVER_FILE="$RESOLVER_DIR/navis.local"

        mkdir -p "$RESOLVER_DIR"

        cat > "$RESOLVER_FILE" << EOF
nameserver 127.0.0.1
port 443
search_order 1
timeout 5
EOF

        echo "✅ Configured macOS resolver for navis.local"
    fi
}

# Install authbind on Linux (optional)
setup_authbind() {
    if [[ "$OS" == "linux" ]]; then
        echo "🔐 Setting up authbind for port 443 without root daemon..."

        if ! command -v authbind &> /dev/null; then
            echo "⚠️  authbind not found. Install with:"
            echo "   Ubuntu/Debian: sudo apt-get install authbind"
            echo "   RHEL/CentOS: sudo yum install authbind"
        else
            mkdir -p ~/.authbind/byport
            touch ~/.authbind/byport/443
            chmod 755 ~/.authbind/byport/443
            echo "✅ Configured authbind for port 443"
        fi
    fi
}

# Create systemd service for auto-start
create_systemd_service() {
    if [[ "$OS" == "linux" ]] && command -v systemctl &> /dev/null; then
        echo "⚙️  Creating systemd service..."

        SERVICE_FILE="/etc/systemd/system/navisai.service"
        DAEMON_PATH="$(which navisai)"

        if [[ -z "$DAEMON_PATH" ]]; then
            DAEMON_PATH="/usr/local/bin/navisai"
        fi

        cat > "$SERVICE_FILE" << EOF
[Unit]
Description=NavisAI Daemon
After=network.target

[Service]
Type=forking
User=$SUDO_USER
ExecStart=$DAEMON_PATH up
ExecStop=$DAEMON_PATH down
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

        systemctl daemon-reload
        systemctl enable navisai
        echo "✅ Created systemd service"
        echo "   Start with: sudo systemctl start navisai"
    fi
}

# Main setup
main() {
    setup_hosts
    setup_resolver
    setup_authbind

    echo ""
    echo "🎉 Setup complete!"
    echo ""
    echo "📚 Next steps:"
    echo "   1. Run: navisai up"
    echo "   2. Visit: https://navis.local/welcome"
    echo ""
    echo "💡 For automatic startup on boot:"
    if [[ "$OS" == "macos" ]]; then
        echo "   Add to Login Items or use launchd"
    elif [[ "$OS" == "linux" ]]; then
        create_systemd_service
    fi
}

# Run setup
main "$@"
