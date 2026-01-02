#!/bin/bash
# Add demo dashboard data to HOPS

DB_PATH="${1:-../data/hops.db}"

echo "Adding demo dashboard data to $DB_PATH..."

# Demo configuration with a sample dashboard
cat > /tmp/hops-demo-config.json << 'EOF'
{
  "dashboards": [
    {
      "id": "home",
      "name": "Home",
      "path": "/home",
      "tabs": [
        {
          "id": "services",
          "name": "Services",
          "groups": [
            {
              "id": "media",
              "name": "Media",
              "collapsed": false,
              "entries": [
                {
                  "id": "plex",
                  "name": "Plex",
                  "url": "https://plex.tv",
                  "icon": "mdi:plex",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 0
                },
                {
                  "id": "jellyfin",
                  "name": "Jellyfin",
                  "url": "https://jellyfin.org",
                  "icon": "simple-icons:jellyfin",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 1
                }
              ],
              "order": 0
            },
            {
              "id": "automation",
              "name": "Automation",
              "collapsed": false,
              "entries": [
                {
                  "id": "homeassistant",
                  "name": "Home Assistant",
                  "url": "https://home-assistant.io",
                  "icon": "mdi:home-assistant",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 0
                },
                {
                  "id": "nodered",
                  "name": "Node-RED",
                  "url": "https://nodered.org",
                  "icon": "mdi:sitemap",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 1
                }
              ],
              "order": 1
            }
          ],
          "order": 0
        },
        {
          "id": "infrastructure",
          "name": "Infrastructure",
          "groups": [
            {
              "id": "monitoring",
              "name": "Monitoring",
              "collapsed": false,
              "entries": [
                {
                  "id": "proxmox",
                  "name": "Proxmox",
                  "url": "https://www.proxmox.com",
                  "icon": "simple-icons:proxmox",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 0
                },
                {
                  "id": "portainer",
                  "name": "Portainer",
                  "url": "https://www.portainer.io",
                  "icon": "simple-icons:portainer",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 1
                },
                {
                  "id": "grafana",
                  "name": "Grafana",
                  "url": "https://grafana.com",
                  "icon": "simple-icons:grafana",
                  "openMode": "newtab",
                  "size": "medium",
                  "order": 2
                }
              ],
              "order": 0
            }
          ],
          "order": 1
        }
      ],
      "order": 0
    }
  ],
  "theme": {
    "mode": "dark"
  },
  "settings": {
    "searchHotkey": "/",
    "defaultView": "/home"
  }
}
EOF

# Update the config in the database
sqlite3 "$DB_PATH" "UPDATE config SET data = '$(cat /tmp/hops-demo-config.json | tr -d '\n')' WHERE id = 1"

rm /tmp/hops-demo-config.json

echo "Demo data added successfully!"
echo "Visit http://10.10.0.9:5173/home to see it"
