#!/bin/bash
set -e

# Install HOPS as a systemd service

if [ "$EUID" -ne 0 ]; then
  echo "Please run with sudo"
  exit 1
fi

USER="${SUDO_USER:-$USER}"
HOPS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "Installing HOPS systemd service..."
echo "User: $USER"
echo "Directory: $HOPS_DIR"

# Create service file
cat > /etc/systemd/system/hops.service <<EOF
[Unit]
Description=HOPS - Home Operations Portal System
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$HOPS_DIR/backend
ExecStart=$HOPS_DIR/backend/hops --port 8080 --data $HOPS_DIR/data --frontend $HOPS_DIR/frontend/build
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload

# Enable service
systemctl enable hops

echo "Service installed successfully!"
echo ""
echo "Commands:"
echo "  sudo systemctl start hops   - Start HOPS"
echo "  sudo systemctl stop hops    - Stop HOPS"
echo "  sudo systemctl status hops  - Check status"
echo "  sudo systemctl restart hops - Restart HOPS"
echo "  sudo journalctl -u hops -f  - View logs"
