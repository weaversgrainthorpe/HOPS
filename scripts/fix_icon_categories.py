#!/usr/bin/env python3
"""Fix icon categorization for miscategorized dashboard icons."""

import sqlite3

DB_PATH = "/home/jonathan/data/hops.db"

# Recategorization rules using EXACT ID matches or controlled patterns
EXACT_RECATEGORIZE = {
    # Social Media -> Communication (exact IDs)
    "communication": [
        "facebook", "facebook-light", "facebook-dark",
        "instagram", "instagram-light", "instagram-dark",
        "twitter", "twitter-light", "twitter-dark",
        "tiktok", "tiktok-light", "tiktok-dark",
        "snapchat", "snapchat-light", "snapchat-dark",
        "pinterest", "pinterest-light", "pinterest-dark",
        "linkedin", "linkedin-light", "linkedin-dark",
        "reddit", "reddit-light", "reddit-dark",
        "tumblr", "tumblr-light", "tumblr-dark",
        "mastodon", "mastodon-light", "mastodon-dark",
        "bluesky", "bluesky-light", "bluesky-dark",
        "threads", "threads-light", "threads-dark",
        "eitaa", "eitaa-light", "eitaa-dark",
        "weibo", "weibo-light", "weibo-dark",
        "patreon", "patreon-light", "patreon-dark",
        "ko-fi", "ko-fi-light", "ko-fi-dark",
        "medium", "medium-light", "medium-dark",
        "lemmy", "lemmy-light", "lemmy-dark",
        "peertube", "peertube-light", "peertube-dark",
        "pleroma", "pleroma-light", "pleroma-dark",
        "misskey", "misskey-light", "misskey-dark",
        "friendica", "friendica-light", "friendica-dark",
        "line", "line-light", "line-dark",
    ],

    # Media apps (exact IDs)
    "media": [
        "tvheadend", "tvheadend-light", "tvheadend-dark",
        "tunarr", "tunarr-light", "tunarr-dark",
        "thelounge", "thelounge-light", "thelounge-dark",
        "memories", "memories-light", "memories-dark",
        "photoview", "photoview-light", "photoview-dark",
        "recalbox", "recalbox-light", "recalbox-dark",
        "arcane", "arcane-light", "arcane-dark",
        "pterodactyl", "pterodactyl-light", "pterodactyl-dark",
        "music-assistant", "music-assistant-light", "music-assistant-dark",
        "mpd", "mpd-light", "mpd-dark",
        "snapcast", "snapcast-light", "snapcast-dark",
        "volumio", "volumio-light", "volumio-dark",
        "hifiberry", "hifiberry-light", "hifiberry-dark",
        "lyrion", "lyrion-light", "lyrion-dark",
        "youtube-music", "youtube-music-light", "youtube-music-dark",
        "pocket-casts", "pocket-casts-light", "pocket-casts-dark",
        "castopod", "castopod-light", "castopod-dark",
        "amp", "amp-light", "amp-dark",
        "roon", "roon-light", "roon-dark",
        "librespot", "librespot-light", "librespot-dark",
        "moode", "moode-light", "moode-dark",
        "mopidy", "mopidy-light", "mopidy-dark",
        "batocera", "batocera-light", "batocera-dark",
        "lakka", "lakka-light", "lakka-dark",
        "gamevault", "gamevault-light", "gamevault-dark",
        "pegasus", "pegasus-light", "pegasus-dark",
        "crafty", "crafty-light", "crafty-dark",
    ],

    # Hardware/IoT (exact IDs)
    "hardware": [
        "alexa", "alexa-light", "alexa-dark",
        "google-home", "google-home-light", "google-home-dark",
        "netatmo", "netatmo-light", "netatmo-dark",
        "elgato", "elgato-light", "elgato-dark",
        "logitech", "logitech-light", "logitech-dark",
        "octoprint", "octoprint-light", "octoprint-dark",
        "fluidd", "fluidd-light", "fluidd-dark",
        "mainsail", "mainsail-light", "mainsail-dark",
        "klipper", "klipper-light", "klipper-dark",
        "obico", "obico-light", "obico-dark",
        "prusa", "prusa-light", "prusa-dark",
        "willow", "willow-light", "willow-dark",
        "wled", "wled-light", "wled-dark",
        "hyperion", "hyperion-light", "hyperion-dark",
        "pikvm", "pikvm-light", "pikvm-dark",
        "bambulab", "bambulab-light", "bambulab-dark",
        "bambu-lab", "bambu-lab-light", "bambu-lab-dark",
        "philips-hue", "philips-hue-light", "philips-hue-dark",
        "streamdeck", "streamdeck-light", "streamdeck-dark",
        "stream-deck", "stream-deck-light", "stream-deck-dark",
        "elgato-wave-link", "elgato-wave-link-light", "elgato-wave-link-dark",
        "corsair", "corsair-light", "corsair-dark",
        "razer", "razer-light", "razer-dark",
        "creality", "creality-light", "creality-dark",
        "anycubic", "anycubic-light", "anycubic-dark",
        "elegoo", "elegoo-light", "elegoo-dark",
        "tidbyt", "tidbyt-light", "tidbyt-dark",
        "divoom", "divoom-light", "divoom-dark",
        "ulanzi", "ulanzi-light", "ulanzi-dark",
    ],

    # Arr suite -> Downloads (exact IDs)
    "downloads": [
        "cleanuperr", "cleanuperr-light", "cleanuperr-dark",
        "maintainerr", "maintainerr-light", "maintainerr-dark",
        "unpackerr", "unpackerr-light", "unpackerr-dark",
        "upgradinatorr", "upgradinatorr-light", "upgradinatorr-dark",
        "notifiarr", "notifiarr-light", "notifiarr-dark",
        "traktarr", "traktarr-light", "traktarr-dark",
        "recyclarr", "recyclarr-light", "recyclarr-dark",
        "whisparr", "whisparr-light", "whisparr-dark",
        "decluttarr", "decluttarr-light", "decluttarr-dark",
        "wizarr", "wizarr-light", "wizarr-dark",
        "byparr", "byparr-light", "byparr-dark",
        "eraserr", "eraserr-light", "eraserr-dark",
        "excludarr", "excludarr-light", "excludarr-dark",
        "invitarr", "invitarr-light", "invitarr-dark",
    ],

    # Monitoring/Dashboards (exact IDs)
    "monitoring": [
        "price-buddy", "price-buddy-light", "price-buddy-dark",
        "changedetection", "changedetection-light", "changedetection-dark",
        "changedetection-io", "changedetection-io-light", "changedetection-io-dark",
        "renovate", "renovate-light", "renovate-dark",
        "scrutiny", "scrutiny-light", "scrutiny-dark",
        "diun", "diun-light", "diun-dark",
        "whatsupdocker", "whatsupdocker-light", "whatsupdocker-dark",
        "whats-up-docker", "whats-up-docker-light", "whats-up-docker-dark",
    ],

    # Storage/Documents (exact IDs)
    "storage": [
        "documenso", "documenso-light", "documenso-dark",
        "stirling-pdf", "stirling-pdf-light", "stirling-pdf-dark",
        "docspell", "docspell-light", "docspell-dark",
        "double-commander", "double-commander-light", "double-commander-dark",
        "karakeep", "karakeep-light", "karakeep-dark",
        "feedlynx", "feedlynx-light", "feedlynx-dark",
        "wallabag", "wallabag-light", "wallabag-dark",
        "linkace", "linkace-light", "linkace-dark",
        "hoarder", "hoarder-light", "hoarder-dark",
        "shiori", "shiori-light", "shiori-dark",
        "archivebox", "archivebox-light", "archivebox-dark",
        "linkwarden", "linkwarden-light", "linkwarden-dark",
    ],
}

def main():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # First, reset categories for ALL icons to their original values
    # by re-running the categorization logic
    cursor.execute("""
        SELECT id FROM icons
    """)
    dashboard_icons = [row[0] for row in cursor.fetchall()]
    print(f"Found {len(dashboard_icons)} icons to recategorize")

    # Import the categorization function
    import sys
    sys.path.insert(0, '/home/jonathan/HOPS/scripts')
    from import_dashboard_icons import categorize_icon

    # Reset all dashboard icons to their calculated categories
    for icon_id in dashboard_icons:
        category = categorize_icon(icon_id + ".svg")
        cursor.execute("""
            UPDATE icons SET category_id = ? WHERE id = ?
        """, (category, icon_id))

    conn.commit()
    print("Reset all dashboard icon categories")

    # Now apply exact recategorizations
    updated = 0
    for category, icon_ids in EXACT_RECATEGORIZE.items():
        for icon_id in icon_ids:
            cursor.execute("""
                UPDATE icons SET category_id = ? WHERE id = ?
            """, (category, icon_id))
            if cursor.rowcount > 0:
                updated += cursor.rowcount

    conn.commit()
    conn.close()

    print(f"\nTotal icons updated with exact matches: {updated}")

    # Print new counts
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT category_id, COUNT(*) FROM icons GROUP BY category_id ORDER BY COUNT(*) DESC")
    print("\nIcons by category:")
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]}")
    conn.close()


if __name__ == "__main__":
    main()
