#!/usr/bin/env python3
"""Fix entry icons by matching them to dashboard icons."""

import os
import sqlite3
import json
import re

DB_PATH = "/home/jonathan/HOPS/data/hops.db"
ICONS_DIR = "/home/jonathan/HOPS/data/icons/dashboard-icons"

def get_dashboard_icons():
    """Get list of available dashboard icons."""
    icons = {}
    for filename in os.listdir(ICONS_DIR):
        if filename.endswith('.svg') and '-dark.' not in filename and '-light.' not in filename:
            base_name = filename.replace('.svg', '').lower()
            icons[base_name] = f"/api/icons/dashboard/{filename}"
    return icons

def normalize_name(name):
    """Normalize entry name for matching."""
    # Convert to lowercase
    name = name.lower()
    # Remove common suffixes
    name = re.sub(r'\s*(router|server|main|conservatory|living room|snug|study|bedroom|kitchen|office)$', '', name, flags=re.IGNORECASE)
    # Replace spaces with hyphens
    name = name.replace(' ', '-')
    # Remove special characters
    name = re.sub(r'[^a-z0-9-]', '', name)
    return name

def find_best_match(entry_name, dashboard_icons):
    """Find the best matching dashboard icon for an entry name."""
    normalized = normalize_name(entry_name)

    # Skip very short names to avoid false matches
    if len(normalized) < 3:
        return None

    # Direct match
    if normalized in dashboard_icons:
        return dashboard_icons[normalized]

    # Check for partial matches - but require significant overlap
    for icon_name, icon_url in dashboard_icons.items():
        # Skip very short icon names (like 'c', 'a', etc.) to avoid false positives
        if len(icon_name) < 4:
            continue
        # Only match if the full icon name is in the entry or vice versa
        if icon_name == normalized:
            return icon_url

    # Check for common aliases
    aliases = {
        'pihole': 'pi-hole',
        'pi-hole': 'pi-hole',
        'tplink': 'tp-link',
        'tp-link': 'tp-link',
        'tp link': 'tp-link',
        'homeassistant': 'home-assistant',
        'home assistant': 'home-assistant',
        'hass': 'home-assistant',
        'proxmox': 'proxmox',
        'jellyfin': 'jellyfin',
        'plex': 'plex',
        'qnap': 'qnap',
        'cloudflare': 'cloudflare',
        'postgres': 'postgresql',
        'postgresql': 'postgresql',
        'google': 'google',
        'audiobookshelf': 'audiobookshelf',
    }

    for alias, target in aliases.items():
        if alias in normalized and target in dashboard_icons:
            return dashboard_icons[target]

    return None

def main():
    dashboard_icons = get_dashboard_icons()
    print(f"Found {len(dashboard_icons)} dashboard icons")

    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # Get current config
    cursor.execute("SELECT data FROM config WHERE id = 1")
    row = cursor.fetchone()
    if not row:
        print("No config found!")
        return

    config = json.loads(row[0])
    changes = []

    # Iterate through all entries
    for dashboard in config.get('dashboards', []):
        for tab in dashboard.get('tabs', []):
            for group in tab.get('groups', []):
                for entry in group.get('entries', []):
                    name = entry.get('name', '')
                    current_icon = entry.get('icon', '')
                    current_icon_url = entry.get('iconUrl')

                    # Skip if already has iconUrl
                    if current_icon_url:
                        continue

                    # Try to find a matching dashboard icon
                    match = find_best_match(name, dashboard_icons)
                    if match:
                        changes.append({
                            'name': name,
                            'old_icon': current_icon,
                            'new_iconUrl': match
                        })
                        entry['iconUrl'] = match
                        # Keep the icon as fallback but clear MDI generic ones
                        if current_icon in ['mdi:application', 'mdi:router', 'mdi:shield-half-full']:
                            entry['icon'] = ''

    if not changes:
        print("No entries need updating!")
        return

    print(f"\nFound {len(changes)} entries to update:")
    for change in changes:
        print(f"  - {change['name']}: {change['old_icon']} -> {change['new_iconUrl']}")

    # Ask for confirmation (auto-apply with --yes flag)
    import sys
    if '--yes' in sys.argv:
        print("\nAuto-applying changes...")
    else:
        response = input("\nApply changes? (y/n): ").strip().lower()
        if response != 'y':
            print("Cancelled.")
            return

    # Update config
    cursor.execute("UPDATE config SET data = ?, updated_at = datetime('now') WHERE id = 1",
                   (json.dumps(config, indent=2),))
    conn.commit()

    print(f"\nUpdated {len(changes)} entries!")
    conn.close()

if __name__ == "__main__":
    main()
