<script lang="ts">
  import Icon from '@iconify/svelte';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { dialogContentKeydown, dialogWindowEscape } from '$lib/utils/dialogKeys';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  const appVersion = __APP_VERSION__;
  let activeTab = $state<'shortcuts' | 'editing' | 'features'>('shortcuts');

  let dialogEl = $state<HTMLElement>();
  // Escape: the content element handles it (dialogKeys); window is the fallback for focus outside.
  function handleKeydown(e: KeyboardEvent) {
    dialogWindowEscape(e, dialogEl, onClose);
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose}>
  <div
    bind:this={dialogEl}
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => dialogContentKeydown(e, onClose)}
    role="dialog"
    aria-modal="true"
    aria-labelledby="help-modal-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="help-modal-title"><Icon icon="mdi:help-circle" width="28" /> Help</h2>
      <button class="close-btn" onclick={onClose}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="tabs">
      <button class="tab" class:active={activeTab === 'shortcuts'} onclick={() => activeTab = 'shortcuts'}>
        <Icon icon="mdi:keyboard" width="18" />
        Shortcuts
      </button>
      <button class="tab" class:active={activeTab === 'editing'} onclick={() => activeTab = 'editing'}>
        <Icon icon="mdi:pencil" width="18" />
        Editing
      </button>
      <button class="tab" class:active={activeTab === 'features'} onclick={() => activeTab = 'features'}>
        <Icon icon="mdi:star" width="18" />
        Features
      </button>
    </div>

    <div class="modal-body">
      {#if activeTab === 'shortcuts'}
        <div class="help-section">
          <h3>Viewing</h3>
          <p class="section-desc">These work on any dashboard.</p>

          <div class="shortcut-list">
            <div class="shortcut">
              <div class="keys">
                <kbd>/</kbd>
              </div>
              <div class="desc">Search this dashboard's tiles and folders</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>
              </div>
              <div class="desc">Move between tiles</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Enter</kbd>
              </div>
              <div class="desc">Open the highlighted tile</div>
            </div>
          </div>
        </div>

        <div class="help-section">
          <h3>Editing</h3>
          <p class="section-desc">These work in edit mode. On a Mac, use Cmd instead of Ctrl.</p>

          <div class="shortcut-list">
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>S</kbd>
              </div>
              <div class="desc">Save your changes</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>Z</kbd>
              </div>
              <div class="desc">Undo</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> or <kbd>Ctrl</kbd> + <kbd>Y</kbd>
              </div>
              <div class="desc">Redo</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>C</kbd>
              </div>
              <div class="desc">Copy the selected tiles and folders</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>X</kbd>
              </div>
              <div class="desc">Cut the selected tiles and folders</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>V</kbd>
              </div>
              <div class="desc">Paste into the open folder (or the tab)</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Delete</kbd>
              </div>
              <div class="desc">Delete what is selected (asks first)</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Shift</kbd> + <kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd>
              </div>
              <div class="desc">Resize the selected open folder</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Alt</kbd> + <kbd>←</kbd> <kbd>→</kbd>
              </div>
              <div class="desc">Move the focused tab left or right</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Escape</kbd>
              </div>
              <div class="desc">Close a dialog, or clear the selection</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
              </div>
              <div class="desc">Save and close a dialog</div>
            </div>
          </div>
        </div>

      {:else if activeTab === 'editing'}
        <div class="help-section">
          <h3>Edit Mode</h3>
          <p class="section-desc">Click the pencil in the top bar to start editing. Your changes are a draft until you click Save in the toolbar at the bottom of the screen.</p>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:drag" width="24" />
              <div>
                <strong>Drag & Drop</strong>
                <p>Drag tiles and folders anywhere: into folders, out of them, or onto another tab's name. Hold a tile over another tile to make a folder of the two. Drag tabs to reorder them.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:plus-circle" width="24" />
              <div>
                <strong>Add Items</strong>
                <p>Use Add tile, Add folder and Add tab in the toolbar, or right-click inside a folder or tab.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:pencil" width="24" />
              <div>
                <strong>Edit Items</strong>
                <p>Click an item's pencil, double-click it, or right-click it and choose Edit.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:folder-move" width="24" />
              <div>
                <strong>Move or Copy</strong>
                <p>Right-click › Move/Copy to… sends tiles and folders to any dashboard, tab or folder.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:trash-can" width="24" />
              <div>
                <strong>Delete Items</strong>
                <p>Delete tabs, folders, or tiles from their menu (right-click) or with the Delete key.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:content-copy" width="24" />
              <div>
                <strong>Copy/Paste Tiles</strong>
                <p>Select tiles or folders and use Ctrl+C/V to copy them into another folder, tab or dashboard.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:undo" width="24" />
              <div>
                <strong>Undo, Save and Discard</strong>
                <p>Undo and Redo step through your changes one at a time. Save stores them; Discard throws away everything since the last save. Leaving edit mode with unsaved changes asks first.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="help-section">
          <h3>Customization Options</h3>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:palette" width="24" />
              <div>
                <strong>Colors</strong>
                <p>Set custom colors for tabs, folders, and tiles.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:opacity" width="24" />
              <div>
                <strong>Opacity</strong>
                <p>Adjust transparency of tabs, folders, and tiles. A tile's background, text and icon each have their own.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:resize" width="24" />
              <div>
                <strong>Tile Sizes</strong>
                <p>Choose Small, Medium or Large. Inside a folder, tiles are shown at the folder's Contents size.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:folder-multiple" width="24" />
              <div>
                <strong>Folders</strong>
                <p>Folders can hold tiles and other folders. Pick a Look (a rounded box, a simple tab or a folder style), put its tab on the left, centre or right, and choose whether it starts expanded or minimised. A full folder shows its contents a page at a time.</p>
              </div>
            </div>
          </div>
        </div>

      {:else if activeTab === 'features'}
        <div class="help-section">
          <h3>Background Options</h3>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:image" width="24" />
              <div>
                <strong>Single Image</strong>
                <p>Pick a picture from the built-in gallery or upload your own. A background can go behind the whole dashboard, behind one tab, or inside one folder.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:view-carousel" width="24" />
              <div>
                <strong>Slideshow</strong>
                <p>Create rotating background slideshows with multiple images.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:movie" width="24" />
              <div>
                <strong>Transitions</strong>
                <p>Choose from crossfade, slide, zoom, blur, flip, Ken Burns, random, and more.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:cloud-upload" width="24" />
              <div>
                <strong>Upload Images</strong>
                <p>Upload your own background images (JPEG, PNG, GIF, WebP).</p>
              </div>
            </div>
          </div>
        </div>

        <div class="help-section">
          <h3>Tile Features</h3>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:console" width="24" />
              <div>
                <strong>Tile Types</strong>
                <p>A Link opens an address. An SSH tile opens your computer's SSH app. A Note is text only, with no link.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:link-variant" width="24" />
              <div>
                <strong>Open Modes</strong>
                <p>Open links in a new tab, the same tab, an embedded iframe, or a popup modal.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:home-export-outline" width="24" />
              <div>
                <strong>Home & Away Addresses</strong>
                <p>Give a tile an Away address (for example through a VPN) and a Home / Away button appears in the top bar. Each browser chooses which address its tiles open.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:heart-pulse" width="24" />
              <div>
                <strong>Status Checks</strong>
                <p>Turn a tile's status check On and it shows a badge: Online (with the response time), Offline or Error. New tiles start Off. Dashboards, tabs and folders can disable status checks for every tile inside them, and Settings can disable status monitoring everywhere; one Disabled level stops every check beneath it. Settings › Dashboards › Blocked status checks lists tiles that are On but stopped that way.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:apps" width="24" />
              <div>
                <strong>Thousands of icons</strong>
                <p>~2,300 bundled app/service icons (homarr-labs) plus access to 200,000+ icons by name via Iconify (the ones HOPS uses are embedded for offline rendering; an uncommon name you type is fetched on demand), plus your own uploads. Manage them in Settings › Icons.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="help-section">
          <h3>In Settings</h3>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:radar" width="24" />
              <div>
                <strong>Network Discovery</strong>
                <p>Point HOPS at your home network and let it find what's already running. Tell it which addresses to look at (a range, a CIDR, or individual IPs, in any mix), pick how thorough to be, and it comes back with a draft of everything it spotted. Tick through what you actually want and HOPS adds them to your dashboard, in sensible folders. Scan again later to see what's new, changed or gone. Open <strong>Settings › Discovery</strong>. It's a head start, not magic — what it finds depends on your network and what's blocking it, so expect a few misses and a few false matches. Nothing lands on your dashboard until you accept it.</p>
                <p><em>Running HOPS in Docker? By default, Docker containers can't "see" the kinds of broadcasts smart TVs, Sonos, and AirPlay use to announce themselves — that's a Docker quirk, not a HOPS one. Port scanning and subdomain lookups still work fine. For full coverage on Linux, run with <code>network_mode: host</code>. The Installation &amp; Deployment Guide has the full picture.</em></p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:bookmark-plus-outline" width="24" />
              <div>
                <strong>Add to HOPS bookmark</strong>
                <p>Drag the Add to HOPS button from Settings › Dashboards to your bookmarks bar. Click it on any service's page and HOPS opens with a new tile filled in.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:qrcode" width="24" />
              <div>
                <strong>QR Codes</strong>
                <p>Generate a scannable QR for any dashboard from Settings › Dashboards — open it on a phone or tablet without typing the URL.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:link" width="24" />
              <div>
                <strong>Dead Links & Duplicates</strong>
                <p>Settings › Dashboards › Dead links lists tiles whose status check has kept failing (for a week, by default). Duplicates lists tiles that point at the same address and can merge them, showing what it would keep first.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:backup-restore" width="24" />
              <div>
                <strong>Automatic Backups</strong>
                <p>HOPS backs up its database when it starts, before every save, before a restore or factory reset, and before an upgrade. Create, download, upload and restore backups from Settings › Backups.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:import" width="24" />
              <div>
                <strong>Import / Export</strong>
                <p>Self-contained export bundles all uploaded icons and backgrounds. Import from HOPS, Homer, Dashy, or Heimdall configs; anything that can't be brought across is listed.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:text-box-search-outline" width="24" />
              <div>
                <strong>Logs</strong>
                <p>Settings › Logs shows what HOPS has been doing, with Copy and Download .txt for when you ask for help.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:shield-key" width="24" />
              <div>
                <strong>Security</strong>
                <p>Bcrypt password hashing, HttpOnly session cookies, CSRF protection, and forced password change on first login. Signing out or changing the password ends the session. Forgotten the password? Run the HOPS program with <code>reset-password</code> on the computer that runs it (see Forgot password? when signing in).</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:theme-light-dark" width="24" />
              <div>
                <strong>Themes</strong>
                <p>8 presets with dark, light, and auto modes — including gradient themes. Each browser keeps its own choice.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:format-size" width="24" />
              <div>
                <strong>Text Size</strong>
                <p>Adjust text size with navbar controls (persists in browser).</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:history" width="24" />
              <div>
                <strong>Recently Used</strong>
                <p>Turn on Show recently used in Theme Settings for a row of the tiles you open most. It is kept in this browser only.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="help-section">
          <h3>On Mobile</h3>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:cellphone" width="24" />
              <div>
                <strong>View only on phones</strong>
                <p>Dashboards work great on phones, but editing is hidden on screens 480 pixels wide or narrower. Tablets can edit, though a computer with a mouse is easier. The gear (Settings) stays available so you can still reach Backups and Password.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:qrcode-scan" width="24" />
              <div>
                <strong>Quick mobile access</strong>
                <p>Use the QR code feature in Settings › Dashboards to open any dashboard on your phone — no URL typing required. Then use your browser's Add to Home Screen to open HOPS from its own icon.</p>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <span class="version">HOPS v{appVersion}</span>
      <button class="btn-primary" onclick={onClose}>Got it!</button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 600px;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.25rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .tabs {
    display: flex;
    gap: 0.25rem;
    padding: 0.75rem 1.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-tertiary);
  }

  .tab {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: transparent;
    border: none;
    border-radius: 0.375rem;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
  }

  .tab:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .tab.active {
    background: var(--accent-solid);
    color: var(--on-accent);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .help-section {
    margin-bottom: 2rem;
  }

  .help-section:last-child {
    margin-bottom: 0;
  }

  .help-section h3 {
    margin: 0 0 0.5rem 0;
    font-size: 1.125rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .section-desc {
    margin: 0 0 1rem 0;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .shortcut {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
  }

  .keys {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    flex-wrap: wrap;
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0.25rem 0.5rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    font-family: monospace;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-primary);
    min-width: 1.5rem;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
  }

  .desc {
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .feature-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .feature {
    display: flex;
    gap: 1rem;
    align-items: flex-start;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
  }

  .feature > :global(svg) {
    flex-shrink: 0;
    color: var(--accent-text);
  }

  .feature strong {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--text-primary);
  }

  .feature p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.4;
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border);
  }

  .version {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  /* .btn-primary styles are defined globally in app.css */

  @media (max-width: 640px) {
    .modal-content {
      max-height: 100vh;
      border-radius: 0;
    }

    .tabs {
      overflow-x: auto;
      -webkit-overflow-scrolling: touch;
    }

    .shortcut {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }
  }
</style>
