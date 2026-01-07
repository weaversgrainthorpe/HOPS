<script lang="ts">
  import Icon from '@iconify/svelte';
  import { theme, setTheme, applyThemePreset } from '$lib/stores/theme';
  import { browser } from '$app/environment';
  import { focusTrap } from '$lib/utils/focusTrap';
  import { createGridKeyboardHandler } from '$lib/utils/gridKeyboardNav';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  type Theme = 'light' | 'dark' | 'auto';

  const modes: { id: Theme; name: string; icon: string; description: string }[] = [
    { id: 'dark', name: 'Dark', icon: 'mdi:weather-night', description: 'Classic dark theme' },
    { id: 'light', name: 'Light', icon: 'mdi:weather-sunny', description: 'Bright light theme' },
    { id: 'auto', name: 'Auto', icon: 'mdi:theme-light-dark', description: 'Follow system preference' }
  ];

  const themePresets = [
    {
      id: 'default',
      name: 'Default',
      description: 'Classic blue theme',
      dark: {
        primary: '#0f172a',
        secondary: '#1e293b',
        tertiary: '#334155',
        accent: '#3b82f6',
        accentHover: '#2563eb'
      },
      light: {
        primary: '#f8fafc',
        secondary: '#f1f5f9',
        tertiary: '#e2e8f0',
        accent: '#3b82f6',
        accentHover: '#2563eb'
      }
    },
    {
      id: 'metallic',
      name: 'Metallic',
      description: 'Chrome and silver tones',
      dark: {
        primary: '#18181b',
        secondary: '#27272a',
        tertiary: '#3f3f46',
        accent: '#a1a1aa',
        accentHover: '#71717a'
      },
      light: {
        primary: '#fafafa',
        secondary: '#f4f4f5',
        tertiary: '#e4e4e7',
        accent: '#71717a',
        accentHover: '#52525b'
      }
    },
    {
      id: 'modern',
      name: 'Modern',
      description: 'Clean minimal design',
      dark: {
        primary: '#111827',
        secondary: '#1f2937',
        tertiary: '#374151',
        accent: '#6366f1',
        accentHover: '#4f46e5'
      },
      light: {
        primary: '#ffffff',
        secondary: '#f9fafb',
        tertiary: '#f3f4f6',
        accent: '#6366f1',
        accentHover: '#4f46e5'
      }
    },
    {
      id: 'subtle',
      name: 'Subtle',
      description: 'Muted pastel colors',
      dark: {
        primary: '#1c1917',
        secondary: '#292524',
        tertiary: '#44403c',
        accent: '#a78bfa',
        accentHover: '#8b5cf6'
      },
      light: {
        primary: '#fef7f3',
        secondary: '#fef3f0',
        tertiary: '#fde8e0',
        accent: '#c084fc',
        accentHover: '#a855f7'
      }
    },
    {
      id: 'cyberpunk',
      name: 'Cyberpunk',
      description: 'Neon futuristic vibes',
      dark: {
        primary: '#0a0e1a',
        secondary: '#111827',
        tertiary: '#1e293b',
        accent: '#ec4899',
        accentHover: '#db2777'
      },
      light: {
        primary: '#fdf4ff',
        secondary: '#fae8ff',
        tertiary: '#f5d0fe',
        accent: '#d946ef',
        accentHover: '#c026d3'
      }
    },
    {
      id: 'sunset',
      name: 'Sunset',
      description: 'Warm gradient colors',
      gradient: true,
      dark: {
        primary: '#1e1b4b',
        secondary: '#312e81',
        tertiary: '#4c1d95',
        accent: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
        accentHover: 'linear-gradient(135deg, #ea580c 0%, #db2777 100%)'
      },
      light: {
        primary: '#fef3c7',
        secondary: '#fde68a',
        tertiary: '#fcd34d',
        accent: 'linear-gradient(135deg, #f97316 0%, #ec4899 100%)',
        accentHover: 'linear-gradient(135deg, #ea580c 0%, #db2777 100%)'
      }
    },
    {
      id: 'ocean',
      name: 'Ocean',
      description: 'Cool water gradients',
      gradient: true,
      dark: {
        primary: '#0a1929',
        secondary: '#0c2942',
        tertiary: '#0f3a5c',
        accent: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%)',
        accentHover: 'linear-gradient(135deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)'
      },
      light: {
        primary: '#e0f2fe',
        secondary: '#bae6fd',
        tertiary: '#7dd3fc',
        accent: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 50%, #8b5cf6 100%)',
        accentHover: 'linear-gradient(135deg, #0891b2 0%, #2563eb 50%, #7c3aed 100%)'
      }
    },
    {
      id: 'forest',
      name: 'Forest',
      description: 'Natural green gradients',
      gradient: true,
      dark: {
        primary: '#0a1f0f',
        secondary: '#0e3018',
        tertiary: '#134124',
        accent: 'linear-gradient(135deg, #14b8a6 0%, #10b981 50%, #84cc16 100%)',
        accentHover: 'linear-gradient(135deg, #0d9488 0%, #059669 50%, #65a30d 100%)'
      },
      light: {
        primary: '#f0fdf4',
        secondary: '#dcfce7',
        tertiary: '#bbf7d0',
        accent: 'linear-gradient(135deg, #14b8a6 0%, #10b981 50%, #84cc16 100%)',
        accentHover: 'linear-gradient(135deg, #0d9488 0%, #059669 50%, #65a30d 100%)'
      }
    }
  ];

  let selectedMode = $state($theme);
  let selectedPreset = $state('default');

  function handleApply() {
    setTheme(selectedMode as 'light' | 'dark' | 'auto');

    // Determine which mode to apply based on selection
    let effectiveMode: 'light' | 'dark' = 'dark';
    if (selectedMode === 'auto') {
      effectiveMode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    } else {
      effectiveMode = selectedMode as 'light' | 'dark';
    }

    applyThemePreset(selectedPreset, effectiveMode);
    onClose();
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }

  // Load saved preset on mount
  if (browser) {
    const savedPreset = localStorage.getItem('hops_theme_preset');
    if (savedPreset) {
      selectedPreset = savedPreset;
    }
  }

  // Keyboard navigation for mode grid (1 column layout)
  const handleModeKeydown = createGridKeyboardHandler(
    () => modes.findIndex(m => m.id === selectedMode),
    {
      columns: 1,
      itemCount: modes.length,
      onSelect: (index) => { selectedMode = modes[index].id; }
    }
  );

  // Keyboard navigation for preset grid (2 columns)
  const handlePresetKeydown = createGridKeyboardHandler(
    () => themePresets.findIndex(p => p.id === selectedPreset),
    {
      columns: 2,
      itemCount: themePresets.length,
      onSelect: (index) => { selectedPreset = themePresets[index].id; }
    }
  );
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onClose} onkeydown={(e) => e.key === 'Escape' && onClose()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="theme-settings-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="theme-settings-title">Theme Settings</h2>
      <button class="close-btn" onclick={onClose}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      <section class="section">
        <h3 id="mode-label">Brightness Mode</h3>
        <div
          class="mode-grid"
          role="radiogroup"
          aria-labelledby="mode-label"
          onkeydown={handleModeKeydown}
          tabindex="-1"
        >
          {#each modes as mode, index}
            <button
              class="mode-card"
              class:selected={selectedMode === mode.id}
              onclick={() => selectedMode = mode.id}
              role="radio"
              aria-checked={selectedMode === mode.id}
              tabindex={selectedMode === mode.id ? 0 : -1}
            >
              <Icon icon={mode.icon} width="32" />
              <div class="mode-info">
                <div class="mode-name">{mode.name}</div>
                <div class="mode-desc">{mode.description}</div>
              </div>
              {#if selectedMode === mode.id}
                <Icon icon="mdi:check-circle" width="24" class="check-icon" />
              {/if}
            </button>
          {/each}
        </div>
      </section>

      <section class="section">
        <h3 id="preset-label">Theme Preset</h3>
        <div
          class="preset-grid"
          role="radiogroup"
          aria-labelledby="preset-label"
          onkeydown={handlePresetKeydown}
          tabindex="-1"
        >
          {#each themePresets as preset}
            <button
              class="preset-card"
              class:selected={selectedPreset === preset.id}
              class:gradient={preset.gradient}
              onclick={() => selectedPreset = preset.id}
              role="radio"
              aria-checked={selectedPreset === preset.id}
              tabindex={selectedPreset === preset.id ? 0 : -1}
            >
              <div class="preset-preview">
                {#if preset.gradient}
                  <div class="preview-color gradient" style="background: {selectedMode === 'light' ? preset.light.accent : preset.dark.accent}"></div>
                {:else}
                  <div class="preview-colors">
                    <div class="preview-color" style="background-color: {selectedMode === 'light' ? preset.light.primary : preset.dark.primary}"></div>
                    <div class="preview-color" style="background-color: {selectedMode === 'light' ? preset.light.secondary : preset.dark.secondary}"></div>
                    <div class="preview-color" style="background-color: {selectedMode === 'light' ? preset.light.accent : preset.dark.accent}"></div>
                  </div>
                {/if}
              </div>
              <div class="preset-info">
                <div class="preset-name">
                  {preset.name}
                  {#if preset.gradient}
                    <Icon icon="mdi:gradient-horizontal" width="16" />
                  {/if}
                </div>
                <div class="preset-desc">{preset.description}</div>
              </div>
              {#if selectedPreset === preset.id}
                <Icon icon="mdi:check-circle" width="20" class="check-icon" />
              {/if}
            </button>
          {/each}
        </div>
      </section>

      <div class="info-box">
        <Icon icon="mdi:information" width="20" />
        <div>
          <p><strong>How it works:</strong> Select a brightness mode (Dark/Light/Auto) and a theme preset. Each preset adapts to both light and dark modes with carefully chosen colors.</p>
          <p style="margin-top: 0.5rem;">Theme applies globally across all dashboards. Per-dashboard customization coming soon!</p>
        </div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn-secondary" onclick={onClose}>
        Cancel
      </button>
      <button class="btn-primary" onclick={handleApply}>
        <Icon icon="mdi:check" width="20" />
        Apply Theme
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-primary);
    border-radius: 0.75rem;
    width: 100%;
    max-width: 600px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    max-height: 90vh;
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    margin: 0;
    font-size: 1.5rem;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    flex: 1;
  }

  .section {
    margin-bottom: 2rem;
  }

  .section:last-of-type {
    margin-bottom: 1rem;
  }

  .section h3 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
    color: var(--text-primary);
  }

  .mode-grid {
    display: grid;
    gap: 0.75rem;
  }

  .mode-card {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
  }

  .mode-card:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .mode-card.selected {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .mode-info {
    flex: 1;
  }

  .mode-name {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
  }

  .mode-desc {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  :global(.check-icon) {
    color: var(--accent);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 0.75rem;
  }

  .preset-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    position: relative;
    text-align: left;
  }

  .preset-card:hover {
    background: var(--bg-tertiary);
    border-color: var(--accent);
    transform: translateY(-2px);
  }

  .preset-card.selected {
    background: var(--bg-tertiary);
    border-color: var(--accent);
  }

  .preset-preview {
    width: 100%;
    height: 60px;
    border-radius: 0.375rem;
    overflow: hidden;
  }

  .preview-colors {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    height: 100%;
    gap: 2px;
  }

  .preview-color {
    width: 100%;
    height: 100%;
  }

  .preview-color.gradient {
    width: 100%;
    height: 100%;
  }

  .preset-info {
    flex: 1;
  }

  .preset-name {
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 0.25rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .preset-desc {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .preset-card :global(.check-icon) {
    position: absolute;
    top: 0.75rem;
    right: 0.75rem;
  }

  .info-box {
    display: flex;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .info-box p {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .modal-footer {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    padding: 1.5rem;
    border-top: 1px solid var(--border);
  }

  button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.625rem 1.25rem;
    border: none;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-secondary);
  }
</style>
