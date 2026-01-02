<script lang="ts">
  import type { Background } from '$lib/types';
  import Icon from '@iconify/svelte';
  import { BACKGROUND_PRESETS, BACKGROUND_CATEGORIES } from '$lib/constants/backgrounds';

  interface Props {
    background?: Background;
    onSave: (background: Background | undefined) => void;
    onCancel: () => void;
    level: 'dashboard' | 'tab'; // What level is this background for
  }

  let { background, onSave, onCancel, level }: Props = $props();

  // State for background configuration
  let backgroundType = $state<'none' | 'color' | 'image' | 'slideshow'>(
    background?.type || 'none'
  );
  let backgroundFit = $state<'cover' | 'contain' | 'fill'>(
    background?.fit || 'cover'
  );
  let colorValue = $state(background?.type === 'color' ? background.value || '#1e293b' : '#1e293b');
  let singleImageUrl = $state(background?.type === 'image' ? background.value || '' : '');
  let slideshowImages = $state<string[]>(
    background?.type === 'slideshow' && background.images ? [...background.images] : []
  );
  let slideshowInterval = $state(background?.interval || 30);
  let selectedCategory = $state('network');
  let customImageUrl = $state('');

  function handleSave() {
    if (backgroundType === 'none') {
      onSave(undefined);
      return;
    }

    const newBackground: Background = {
      type: backgroundType as 'color' | 'image' | 'slideshow',
      fit: backgroundFit
    };

    if (backgroundType === 'color') {
      newBackground.value = colorValue;
    } else if (backgroundType === 'image') {
      newBackground.value = singleImageUrl;
    } else if (backgroundType === 'slideshow') {
      newBackground.images = slideshowImages;
      newBackground.interval = slideshowInterval;
    }

    onSave(newBackground);
  }

  function handleAddPreset(url: string) {
    if (backgroundType === 'slideshow') {
      if (!slideshowImages.includes(url)) {
        slideshowImages = [...slideshowImages, url];
      }
    } else if (backgroundType === 'image') {
      singleImageUrl = url;
    }
  }

  function handleAddCustomUrl() {
    if (!customImageUrl.trim()) return;

    if (backgroundType === 'slideshow') {
      if (!slideshowImages.includes(customImageUrl)) {
        slideshowImages = [...slideshowImages, customImageUrl];
      }
    } else if (backgroundType === 'image') {
      singleImageUrl = customImageUrl;
    }
    customImageUrl = '';
  }

  function handleRemoveImage(index: number) {
    slideshowImages = slideshowImages.filter((_, i) => i !== index);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    }
  }

  const categoryPresets = $derived(
    BACKGROUND_PRESETS.filter(p => p.category === selectedCategory)
  );
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="modal-backdrop" onclick={onCancel}>
  <div class="modal-content" onclick={(e) => e.stopPropagation()}>
    <div class="modal-header">
      <h2>Configure {level === 'dashboard' ? 'Dashboard' : 'Tab'} Background</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      <!-- Background Type Selection -->
      <div class="form-group">
        <label>Background Type</label>
        <div class="type-buttons">
          <button
            class="type-btn"
            class:active={backgroundType === 'none'}
            onclick={() => backgroundType = 'none'}
          >
            <Icon icon="mdi:close-circle-outline" width="24" />
            <span>None</span>
          </button>
          <button
            class="type-btn"
            class:active={backgroundType === 'color'}
            onclick={() => backgroundType = 'color'}
          >
            <Icon icon="mdi:palette" width="24" />
            <span>Color</span>
          </button>
          <button
            class="type-btn"
            class:active={backgroundType === 'image'}
            onclick={() => backgroundType = 'image'}
          >
            <Icon icon="mdi:image" width="24" />
            <span>Image</span>
          </button>
          <button
            class="type-btn"
            class:active={backgroundType === 'slideshow'}
            onclick={() => backgroundType = 'slideshow'}
          >
            <Icon icon="mdi:view-carousel" width="24" />
            <span>Slideshow</span>
          </button>
        </div>
      </div>

      <!-- Color Picker (when type is color) -->
      {#if backgroundType === 'color'}
        <div class="form-group">
          <label for="color">Background Color</label>
          <input
            id="color"
            type="color"
            bind:value={colorValue}
            class="color-input"
          />
          <input
            type="text"
            bind:value={colorValue}
            placeholder="#1e293b"
            class="color-text"
          />
        </div>
      {/if}

      <!-- Image Fit Option (for image and slideshow) -->
      {#if backgroundType === 'image' || backgroundType === 'slideshow'}
        <div class="form-group">
          <label>Image Fit</label>
          <div class="fit-buttons">
            <button
              class="fit-btn"
              class:active={backgroundFit === 'cover'}
              onclick={() => backgroundFit = 'cover'}
              title="Cover - Image covers entire area (may crop)"
            >
              <Icon icon="mdi:arrow-expand-all" width="20" />
              <span>Cover</span>
            </button>
            <button
              class="fit-btn"
              class:active={backgroundFit === 'contain'}
              onclick={() => backgroundFit = 'contain'}
              title="Contain - Entire image visible (may have bars)"
            >
              <Icon icon="mdi:fit-to-screen" width="20" />
              <span>Contain</span>
            </button>
            <button
              class="fit-btn"
              class:active={backgroundFit === 'fill'}
              onclick={() => backgroundFit = 'fill'}
              title="Fill - Stretch to fill (may distort)"
            >
              <Icon icon="mdi:arrow-expand" width="20" />
              <span>Fill</span>
            </button>
          </div>
        </div>
      {/if}

      <!-- Single Image URL (when type is image) -->
      {#if backgroundType === 'image'}
        <div class="form-group">
          <label for="imageUrl">Image URL</label>
          <input
            id="imageUrl"
            type="text"
            bind:value={singleImageUrl}
            placeholder="https://example.com/image.jpg or /backgrounds/image.jpg"
          />
        </div>

        <!-- Image Preview -->
        {#if singleImageUrl}
          <div class="preview">
            <img src={singleImageUrl} alt="Preview" />
          </div>
        {/if}
      {/if}

      <!-- Slideshow Configuration (when type is slideshow) -->
      {#if backgroundType === 'slideshow'}
        <div class="form-group">
          <label for="interval">Rotation Interval (seconds)</label>
          <input
            id="interval"
            type="number"
            bind:value={slideshowInterval}
            min="5"
            max="300"
            step="5"
          />
        </div>

        <div class="form-group">
          <label>Slideshow Images ({slideshowImages.length})</label>

          {#if slideshowImages.length > 0}
            <div class="image-list">
              {#each slideshowImages as imageUrl, index}
                <div class="image-item">
                  <img src={imageUrl} alt="Slide {index + 1}" />
                  <button
                    class="remove-btn"
                    onclick={() => handleRemoveImage(index)}
                    title="Remove image"
                  >
                    <Icon icon="mdi:close" width="16" />
                  </button>
                  <span class="image-index">{index + 1}</span>
                </div>
              {/each}
            </div>
          {:else}
            <p class="empty-message">No images added yet. Select from presets below or add a custom URL.</p>
          {/if}
        </div>

        <!-- Custom URL Input -->
        <div class="form-group">
          <label>Add Custom Image URL</label>
          <div class="url-input-group">
            <input
              type="text"
              bind:value={customImageUrl}
              placeholder="https://example.com/image.jpg"
              onkeydown={(e) => e.key === 'Enter' && handleAddCustomUrl()}
            />
            <button onclick={handleAddCustomUrl} class="add-btn">
              <Icon icon="mdi:plus" width="20" />
              Add
            </button>
          </div>
        </div>
      {/if}

      <!-- Preset Gallery (for image and slideshow) -->
      {#if backgroundType === 'image' || backgroundType === 'slideshow'}
        <div class="presets-section">
          <h3>Preset Backgrounds</h3>

          <!-- Category Tabs -->
          <div class="category-tabs">
            {#each BACKGROUND_CATEGORIES as category}
              <button
                class="category-tab"
                class:active={selectedCategory === category.id}
                onclick={() => selectedCategory = category.id}
              >
                <Icon icon={category.icon} width="20" />
                <span>{category.name}</span>
              </button>
            {/each}
          </div>

          <!-- Preset Grid -->
          <div class="preset-grid">
            {#each categoryPresets as preset}
              <button
                class="preset-card"
                onclick={() => handleAddPreset(preset.url)}
                title={preset.name}
              >
                <img src={preset.url} alt={preset.name} loading="lazy" />
                <div class="preset-overlay">
                  <Icon icon="mdi:plus-circle" width="32" />
                  <span>{preset.name}</span>
                </div>
              </button>
            {/each}
          </div>
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-secondary" onclick={onCancel}>Cancel</button>
      <button class="btn-primary" onclick={handleSave}>Save Background</button>
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
    max-width: 900px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3);
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
    font-weight: 600;
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

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
  }

  .form-group {
    margin-bottom: 1.5rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .form-group input[type="text"],
  .form-group input[type="number"] {
    width: 100%;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .form-group input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .type-buttons,
  .fit-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 0.5rem;
  }

  .type-btn,
  .fit-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .type-btn:hover,
  .fit-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .type-btn.active,
  .fit-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .color-input {
    width: 100px;
    height: 50px;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    cursor: pointer;
  }

  .color-text {
    margin-top: 0.5rem;
  }

  .preview {
    margin-top: 1rem;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 1px solid var(--border);
  }

  .preview img {
    width: 100%;
    height: 200px;
    object-fit: cover;
  }

  .image-list {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  .image-item {
    position: relative;
    aspect-ratio: 16/9;
    border-radius: 0.375rem;
    overflow: hidden;
    border: 2px solid var(--border);
  }

  .image-item img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-index {
    position: absolute;
    bottom: 0.25rem;
    left: 0.25rem;
    background: rgba(0, 0, 0, 0.7);
    color: white;
    padding: 0.125rem 0.375rem;
    border-radius: 0.25rem;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .remove-btn {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    background: rgba(239, 68, 68, 0.9);
    color: white;
    border: none;
    border-radius: 0.25rem;
    padding: 0.25rem;
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .image-item:hover .remove-btn {
    opacity: 1;
  }

  .empty-message {
    color: var(--text-secondary);
    font-size: 0.875rem;
    padding: 1rem;
    text-align: center;
    background: var(--bg-tertiary);
    border-radius: 0.375rem;
  }

  .url-input-group {
    display: flex;
    gap: 0.5rem;
  }

  .url-input-group input {
    flex: 1;
  }

  .add-btn {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.75rem 1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .add-btn:hover {
    background: var(--accent-hover);
  }

  .presets-section {
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 1px solid var(--border);
  }

  .presets-section h3 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .category-tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .category-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
  }

  .category-tab:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .category-tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
  }

  .preset-card {
    position: relative;
    aspect-ratio: 16/9;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 2px solid var(--border);
    cursor: pointer;
    background: var(--bg-tertiary);
    transition: all 0.2s;
  }

  .preset-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
  }

  .preset-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .preset-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    opacity: 0;
    transition: opacity 0.2s;
    color: white;
  }

  .preset-card:hover .preset-overlay {
    opacity: 1;
  }

  .preset-overlay span {
    font-size: 0.875rem;
    font-weight: 500;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .btn-secondary,
  .btn-primary {
    padding: 0.75rem 1.5rem;
    border-radius: 0.375rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
    border: none;
  }

  .btn-secondary {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .btn-secondary:hover {
    background: var(--bg-primary);
  }

  .btn-primary {
    background: var(--accent);
    color: white;
  }

  .btn-primary:hover {
    background: var(--accent-hover);
  }

  @media (max-width: 768px) {
    .modal-content {
      max-width: 100%;
      max-height: 100vh;
      border-radius: 0;
    }

    .preset-grid {
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    }

    .category-tabs {
      overflow-x: auto;
      flex-wrap: nowrap;
      -webkit-overflow-scrolling: touch;
    }
  }
</style>
