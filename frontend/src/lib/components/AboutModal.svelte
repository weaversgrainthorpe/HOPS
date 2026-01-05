<script lang="ts">
  import Icon from '@iconify/svelte';
  import { onMount } from 'svelte';
  import { focusTrap } from '$lib/utils/focusTrap';

  interface Props {
    onClose: () => void;
  }

  let { onClose }: Props = $props();

  let backendVersion = $state('...');
  const frontendVersion = __APP_VERSION__;

  onMount(async () => {
    try {
      const response = await fetch('/api/version');
      if (response.ok) {
        const data = await response.json();
        backendVersion = data.version;
      }
    } catch (e) {
      backendVersion = 'Error';
    }
  });

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-overlay" onclick={onClose} role="dialog" aria-modal="true" aria-labelledby="about-title">
  <div class="modal-content" onclick={(e) => e.stopPropagation()} use:focusTrap>
    <button class="close-btn" onclick={onClose} aria-label="Close">
      <Icon icon="mdi:close" width="24" />
    </button>

    <div class="about-header">
      <div class="logo">
        <Icon icon="mdi:rabbit" width="56" />
      </div>
      <h1 id="about-title">HOPS</h1>
      <p class="acronym">Home Operations Portal System</p>
      <p class="tagline">A modern, self-hosted homepage dashboard</p>
    </div>

    <div class="version-info">
      <div class="version-item">
        <span class="label">Frontend</span>
        <span class="value">{frontendVersion}</span>
      </div>
      <div class="version-item">
        <span class="label">Backend</span>
        <span class="value">{backendVersion}</span>
      </div>
    </div>

    <div class="features">
      <h2>Features</h2>
      <ul>
        <li><Icon icon="mdi:view-dashboard" width="18" /> Multiple dashboards</li>
        <li><Icon icon="mdi:tab" width="18" /> Tabbed organization</li>
        <li><Icon icon="mdi:drag" width="18" /> Drag-and-drop</li>
        <li><Icon icon="mdi:image" width="18" /> Custom backgrounds</li>
        <li><Icon icon="mdi:palette" width="18" /> Theme customization</li>
        <li><Icon icon="mdi:heart-pulse" width="18" /> Status monitoring</li>
        <li><Icon icon="mdi:upload" width="18" /> Custom icons</li>
        <li><Icon icon="mdi:import" width="18" /> Homer/Dashy import</li>
      </ul>
    </div>

    <div class="links">
      <a href="https://github.com/jmagar/hops" target="_blank" rel="noopener noreferrer" class="link-btn">
        <Icon icon="mdi:github" width="20" />
        GitHub
      </a>
      <a href="https://github.com/jmagar/hops/issues" target="_blank" rel="noopener noreferrer" class="link-btn">
        <Icon icon="mdi:bug" width="20" />
        Report Issue
      </a>
    </div>

    <div class="credits">
      <p class="authors">Created by Jonathan Brown with Claude (Anthropic)</p>
      <p>Built with SvelteKit, Go, SQLite</p>
      <p class="heart-text">Made with <Icon icon="mdi:heart" width="14" class="heart" /> for the self-hosted community</p>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: var(--z-modal);
    padding: 1rem;
  }

  .modal-content {
    background: var(--bg-secondary);
    border-radius: 1rem;
    padding: 2rem;
    max-width: 480px;
    width: 100%;
    max-height: 90vh;
    overflow-y: auto;
    position: relative;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  }

  .close-btn {
    position: absolute;
    top: 1rem;
    right: 1rem;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.5rem;
    transition: all 0.2s;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .about-header {
    text-align: center;
    margin-bottom: 1.5rem;
  }

  .logo {
    color: var(--accent);
    margin-bottom: 0.5rem;
  }

  .about-header h1 {
    font-size: 2rem;
    margin: 0 0 0.25rem 0;
    background: linear-gradient(135deg, var(--accent), var(--accent-hover));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .acronym {
    color: var(--accent);
    font-size: 0.85rem;
    font-weight: 500;
    margin: 0 0 0.25rem 0;
    letter-spacing: 0.05em;
  }

  .tagline {
    color: var(--text-secondary);
    font-size: 0.9rem;
    margin: 0;
  }

  .version-info {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .version-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
  }

  .version-item .label {
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .version-item .value {
    font-size: 1.25rem;
    font-weight: 600;
    font-family: monospace;
    color: var(--accent);
  }

  .features {
    margin-bottom: 1.5rem;
  }

  .features h2 {
    font-size: 1rem;
    margin: 0 0 0.75rem 0;
    color: var(--text-secondary);
    font-weight: 500;
  }

  .features ul {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.5rem;
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .features li {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .features li :global(svg) {
    color: var(--accent);
    flex-shrink: 0;
  }

  .links {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 1.5rem;
  }

  .link-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    color: var(--text-primary);
    text-decoration: none;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
  }

  .link-btn:hover {
    background: var(--accent);
    color: white;
  }

  .credits {
    text-align: center;
    border-top: 1px solid var(--border);
    padding-top: 1rem;
  }

  .credits p {
    margin: 0 0 0.5rem 0;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .credits .authors {
    font-size: 0.85rem;
    color: var(--text-primary);
    font-weight: 500;
  }

  .heart-text {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
  }

  .credits :global(.heart) {
    color: var(--color-error);
  }
</style>
