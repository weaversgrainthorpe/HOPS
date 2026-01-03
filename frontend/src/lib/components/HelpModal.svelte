<script lang="ts">
  import Icon from '@iconify/svelte';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let activeTab = $state<'shortcuts' | 'editing' | 'features' | 'easter'>('shortcuts');

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onClose}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2><Icon icon="mdi:help-circle" width="28" /> Help</h2>
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
      <button class="tab" class:active={activeTab === 'easter'} onclick={() => activeTab = 'easter'}>
        <Icon icon="mdi:egg-easter" width="18" />
        Secrets
      </button>
    </div>

    <div class="modal-body">
      {#if activeTab === 'shortcuts'}
        <div class="help-section">
          <h3>Keyboard Shortcuts</h3>
          <p class="section-desc">These shortcuts work when edit mode is enabled.</p>

          <div class="shortcut-list">
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>C</kbd>
              </div>
              <div class="desc">Copy selected tile</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>V</kbd>
              </div>
              <div class="desc">Paste tile into focused group</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>X</kbd>
              </div>
              <div class="desc">Cut selected tile</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Escape</kbd>
              </div>
              <div class="desc">Close modal / Cancel edit</div>
            </div>
            <div class="shortcut">
              <div class="keys">
                <kbd>Ctrl</kbd> + <kbd>Enter</kbd>
              </div>
              <div class="desc">Save and close modal</div>
            </div>
          </div>
        </div>

      {:else if activeTab === 'editing'}
        <div class="help-section">
          <h3>Edit Mode</h3>
          <p class="section-desc">Click the edit button in the navbar to enable edit mode.</p>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:drag" width="24" />
              <div>
                <strong>Drag & Drop</strong>
                <p>Drag tiles between groups, reorder tabs, and reorganize your dashboard.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:plus-circle" width="24" />
              <div>
                <strong>Add Items</strong>
                <p>Click + buttons to add new tabs, groups, or tiles.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:pencil" width="24" />
              <div>
                <strong>Edit Items</strong>
                <p>Click the pencil icon on any item to edit its properties.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:trash-can" width="24" />
              <div>
                <strong>Delete Items</strong>
                <p>Click the trash icon to remove tabs, groups, or tiles.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:content-copy" width="24" />
              <div>
                <strong>Copy/Paste Tiles</strong>
                <p>Select a tile and use Ctrl+C/V to duplicate it across groups.</p>
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
                <p>Set custom colors for tabs, groups, and tiles.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:opacity" width="24" />
              <div>
                <strong>Opacity</strong>
                <p>Adjust transparency of tabs, groups, and tiles.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:resize" width="24" />
              <div>
                <strong>Tile Sizes</strong>
                <p>Choose from small, medium, large, or wide tile sizes.</p>
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
                <p>Set a static background image from presets or upload your own.</p>
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
                <p>Choose from crossfade, slide, zoom, blur, flip, Ken Burns, and more.</p>
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
              <Icon icon="mdi:link-variant" width="24" />
              <div>
                <strong>Open Modes</strong>
                <p>Open links in new tab, same tab, or embedded iframe.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:heart-pulse" width="24" />
              <div>
                <strong>Status Checks</strong>
                <p>Monitor service availability with automatic status indicators.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:apps" width="24" />
              <div>
                <strong>6000+ Icons</strong>
                <p>Choose from Material Design Icons, Simple Icons, and more.</p>
              </div>
            </div>
          </div>
        </div>

        <div class="help-section">
          <h3>Admin Features</h3>

          <div class="feature-list">
            <div class="feature">
              <Icon icon="mdi:import" width="24" />
              <div>
                <strong>Import/Export</strong>
                <p>Backup your config or import from Homer/Dashy.</p>
              </div>
            </div>
            <div class="feature">
              <Icon icon="mdi:theme-light-dark" width="24" />
              <div>
                <strong>Themes</strong>
                <p>Switch between dark, light, and auto themes.</p>
              </div>
            </div>
          </div>
        </div>

      {:else if activeTab === 'easter'}
        <div class="help-section">
          <h3>Easter Eggs</h3>
          <p class="section-desc">Hidden surprises in HOPS (requires edit mode).</p>

          <div class="easter-list">
            <div class="easter-egg">
              <div class="easter-trigger">
                <Icon icon="mdi:gamepad-variant" width="24" />
                <div class="keys small">
                  <kbd>↑</kbd><kbd>↑</kbd><kbd>↓</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd><kbd>←</kbd><kbd>→</kbd><kbd>B</kbd><kbd>A</kbd>
                </div>
              </div>
              <div class="easter-desc">
                <strong>Party Mode</strong>
                <p>Enter the Konami Code to trigger disco lights and dancing tiles!</p>
              </div>
            </div>
            <div class="easter-egg">
              <div class="easter-trigger">
                <Icon icon="mdi:rabbit" width="24" />
                <span class="trigger-text">Triple-click HOPS logo</span>
              </div>
              <div class="easter-desc">
                <strong>Hop Animation</strong>
                <p>Triple-click the HOPS logo in the navbar to make everything hop!</p>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <span class="version">HOPS v0.6.0</span>
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
    z-index: 1000;
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
    background: var(--accent);
    color: white;
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

  .keys.small {
    gap: 0.125rem;
  }

  .keys.small kbd {
    padding: 0.125rem 0.375rem;
    font-size: 0.625rem;
    min-width: 1.25rem;
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
    color: var(--accent);
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

  .easter-list {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .easter-egg {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    border: 1px solid var(--border);
  }

  .easter-trigger {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
  }

  .easter-trigger > :global(svg) {
    color: var(--accent);
  }

  .trigger-text {
    font-size: 0.875rem;
    color: var(--text-secondary);
    font-style: italic;
  }

  .easter-desc strong {
    display: block;
    margin-bottom: 0.25rem;
    color: var(--text-primary);
  }

  .easter-desc p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
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

  .btn-primary {
    padding: 0.625rem 1.25rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

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
