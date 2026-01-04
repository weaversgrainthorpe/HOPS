<script lang="ts">
  import type { Background } from '$lib/types';
  import Icon from '@iconify/svelte';
  import { BACKGROUND_PRESETS, BACKGROUND_CATEGORIES, type BackgroundImage, type BackgroundCategory } from '$lib/constants/backgrounds';
  import { getSessionToken } from '$lib/utils/api';
  import { confirm } from '$lib/stores/confirmModal';
  import { focusTrap } from '$lib/utils/focusTrap';

  interface Props {
    background?: Background;
    onSave: (background: Background | undefined) => void;
    onCancel: () => void;
    level: 'dashboard' | 'tab';
    perTabBackgrounds?: boolean;
    onPerTabBackgroundsChange?: (enabled: boolean) => void;
  }

  let { background, onSave, onCancel, level, perTabBackgrounds = false, onPerTabBackgroundsChange }: Props = $props();

  // Local state for the toggle (intentionally captures initial value)
  // svelte-ignore state_referenced_locally
  let perTabEnabled = $state(perTabBackgrounds);

  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let backgroundType = $state<'none' | 'color' | 'image' | 'slideshow'>(
    background?.type || 'none'
  );
  // svelte-ignore state_referenced_locally
  let backgroundFit = $state<'cover' | 'contain' | 'fill'>(
    background?.fit || 'cover'
  );
  // svelte-ignore state_referenced_locally
  let colorValue = $state(background?.type === 'color' ? background.value || '#1e293b' : '#1e293b');
  // svelte-ignore state_referenced_locally
  let singleImageUrl = $state(background?.type === 'image' ? background.value || '' : '');
  // svelte-ignore state_referenced_locally
  let slideshowImages = $state<string[]>(
    background?.type === 'slideshow' && background.images ? [...background.images] : []
  );
  // svelte-ignore state_referenced_locally
  let slideshowInterval = $state(background?.interval || 30);
  // svelte-ignore state_referenced_locally
  let transitionEffect = $state<'crossfade' | 'slide' | 'zoom' | 'fade-black' | 'blur' | 'flip' | 'kenburns' | 'none'>(background?.transition || 'crossfade');
  // svelte-ignore state_referenced_locally
  let transitionDuration = $state(background?.transitionDuration || 1.5);
  let selectedCategory = $state('all');
  let customImageUrl = $state('');

  // Animation preview state
  let previewIndex = $state(0);
  let previewLayer1Visible = $state(true);
  let previewLayer1Image = $state('');
  let previewLayer2Image = $state('');
  let previewIntervalId: number | undefined;
  let previewLayer1KenBurns = $state(0);
  let previewLayer2KenBurns = $state(1);

  // Unified image data
  let categories = $state<BackgroundCategory[]>([]);
  let allImages = $state<BackgroundImage[]>([]);
  let isLoading = $state(true);
  let isUploading = $state(false);
  let uploadError = $state('');
  let fileInput: HTMLInputElement;

  // Hover preview state
  let hoverPreviewUrl = $state<string | null>(null);
  let hoverPreviewPosition = $state({ x: 0, y: 0 });

  // Category management
  let showNewCategoryInput = $state(false);
  let newCategoryName = $state('');
  let newCategoryIcon = $state('mdi:folder-image');

  // Load data on mount
  $effect(() => {
    loadBackgroundData();
  });

  async function loadBackgroundData() {
    isLoading = true;
    try {
      const response = await fetch('/api/backgrounds');
      if (response.ok) {
        const data = await response.json();
        categories = data.categories || BACKGROUND_CATEGORIES;

        // Merge server images with presets
        const serverImages: BackgroundImage[] = data.images || [];
        const serverUrls = new Set(serverImages.map((img: BackgroundImage) => img.url));

        // Add presets that aren't already in server data
        const presetsToAdd = BACKGROUND_PRESETS
          .filter(p => !serverUrls.has(p.url))
          .map(p => ({ ...p, source: 'preset' as const }));

        allImages = [...serverImages, ...presetsToAdd];
      } else {
        // Fallback to local presets
        categories = BACKGROUND_CATEGORIES;
        allImages = BACKGROUND_PRESETS.map(p => ({ ...p, source: 'preset' as const }));
      }
    } catch (error) {
      console.error('Failed to load backgrounds:', error);
      categories = BACKGROUND_CATEGORIES;
      allImages = BACKGROUND_PRESETS.map(p => ({ ...p, source: 'preset' as const }));
    }
    isLoading = false;
  }

  // Filter images by category
  let filteredImages = $derived(
    selectedCategory === 'all'
      ? allImages
      : allImages.filter(img => img.category === selectedCategory)
  );

  // Categories with "All" option
  let allCategories = $derived([
    { id: 'all', name: 'All', icon: 'mdi:image-multiple' },
    ...categories
  ]);

  async function handleFileUpload(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files || files.length === 0) return;

    isUploading = true;
    uploadError = '';

    for (const file of files) {
      if (!file.type.startsWith('image/')) {
        uploadError = 'Only image files are allowed';
        continue;
      }

      if (file.size > 50 * 1024 * 1024) {
        uploadError = 'File size must be less than 50MB';
        continue;
      }

      const formData = new FormData();
      formData.append('file', file);
      formData.append('category', selectedCategory === 'all' ? 'uploaded' : selectedCategory);

      try {
        const token = getSessionToken();
        const response = await fetch('/api/backgrounds', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`
          },
          body: formData
        });

        if (response.ok) {
          const result = await response.json();
          // Add to local state immediately
          const newImage: BackgroundImage = {
            id: result.id,
            name: result.name,
            url: result.url,
            category: result.category,
            source: 'uploaded'
          };
          allImages = [...allImages, newImage];

          // Auto-add to selection
          if (backgroundType === 'slideshow') {
            if (!slideshowImages.includes(result.url)) {
              slideshowImages = [...slideshowImages, result.url];
            }
          } else if (backgroundType === 'image') {
            singleImageUrl = result.url;
          }
        } else {
          const error = await response.text();
          uploadError = error || 'Upload failed';
        }
      } catch (error) {
        uploadError = 'Upload failed: ' + (error as Error).message;
      }
    }

    isUploading = false;
    input.value = '';
  }

  async function handleDeleteImage(image: BackgroundImage) {
    if (image.source === 'preset') {
      // Just hide preset from view (don't actually delete)
      allImages = allImages.filter(img => img.id !== image.id);
      return;
    }

    const confirmed = await confirm({
      title: 'Delete Background',
      message: 'Delete this uploaded background image?',
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!confirmed) return;

    try {
      const token = getSessionToken();
      if (!token) {
        uploadError = 'Session expired. Please log in again at /admin';
        return;
      }
      const response = await fetch(`/api/backgrounds/${image.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        allImages = allImages.filter(img => img.id !== image.id);
        slideshowImages = slideshowImages.filter(url => url !== image.url);
        if (singleImageUrl === image.url) {
          singleImageUrl = '';
        }
      } else if (response.status === 401) {
        uploadError = 'Session expired. Please log in again at /admin';
      } else {
        const errorText = await response.text();
        console.error('Failed to delete image:', response.status, errorText);
        uploadError = `Failed to delete: ${errorText}`;
      }
    } catch (error) {
      console.error('Failed to delete image:', error);
      uploadError = 'Failed to delete image';
    }
  }

  function handleToggleImage(image: BackgroundImage) {
    if (backgroundType === 'slideshow') {
      // Toggle: add if not present, remove if present
      if (slideshowImages.includes(image.url)) {
        slideshowImages = slideshowImages.filter(url => url !== image.url);
      } else {
        slideshowImages = [...slideshowImages, image.url];
      }
    } else if (backgroundType === 'image') {
      singleImageUrl = image.url;
    }
  }

  function handleRemoveFromSlideshow(index: number) {
    slideshowImages = slideshowImages.filter((_, i) => i !== index);
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

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;

    const categoryId = newCategoryName.trim().toLowerCase().replace(/\s+/g, '-');

    try {
      const token = getSessionToken();
      const response = await fetch('/api/backgrounds/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          id: categoryId,
          name: newCategoryName.trim(),
          icon: newCategoryIcon
        })
      });

      if (response.ok) {
        const newCategory: BackgroundCategory = {
          id: categoryId,
          name: newCategoryName.trim(),
          icon: newCategoryIcon
        };
        categories = [...categories, newCategory];
        newCategoryName = '';
        newCategoryIcon = 'mdi:folder-image';
        showNewCategoryInput = false;
        selectedCategory = categoryId;
      } else {
        const errorText = await response.text();
        uploadError = `Failed to create category: ${errorText}`;
      }
    } catch (error) {
      uploadError = 'Failed to create category';
    }
  }

  function handleImageHover(e: MouseEvent, imageUrl: string) {
    hoverPreviewUrl = imageUrl;
    // Position preview to the left or right of the thumbnail, whichever fits better
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const previewWidth = 300;
    const previewHeight = 200;
    const gap = 20;

    // Try left side first, if not enough space use right side
    let x = rect.left - previewWidth - gap;
    if (x < 10) {
      // Not enough space on left, try right side
      x = rect.right + gap;
      // If still off-screen, clamp to viewport
      if (x + previewWidth > window.innerWidth - 10) {
        x = window.innerWidth - previewWidth - 10;
      }
    }

    // Vertical: center on thumbnail, but keep within viewport
    let y = rect.top + (rect.height / 2) - (previewHeight / 2);
    y = Math.max(10, Math.min(y, window.innerHeight - previewHeight - 10));

    hoverPreviewPosition = { x, y };
  }

  function handleImageHoverEnd() {
    hoverPreviewUrl = null;
  }

  function handleSave() {
    // Save perTabBackgrounds setting if changed (dashboard level only)
    if (level === 'dashboard' && onPerTabBackgroundsChange && perTabEnabled !== perTabBackgrounds) {
      onPerTabBackgroundsChange(perTabEnabled);
    }

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
      newBackground.transition = transitionEffect;
      newBackground.transitionDuration = transitionDuration;
    }

    onSave(newBackground);
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onCancel();
    } else if (e.key === 'Enter' && e.ctrlKey) {
      handleSave();
    }
  }

  // Slideshow preview animation
  $effect(() => {
    if (previewIntervalId) {
      clearInterval(previewIntervalId);
      previewIntervalId = undefined;
    }

    if (backgroundType === 'slideshow' && slideshowImages.length > 1) {
      previewIndex = 0;
      previewLayer1Image = slideshowImages[0];
      previewLayer1Visible = true;

      const previewInterval = 5000;
      previewIntervalId = setInterval(() => {
        previewIndex = (previewIndex + 1) % slideshowImages.length;
        const nextImage = slideshowImages[previewIndex];

        if (previewLayer1Visible) {
          previewLayer2Image = nextImage;
          previewLayer2KenBurns = (previewLayer2KenBurns + 2) % 4;
        } else {
          previewLayer1Image = nextImage;
          previewLayer1KenBurns = (previewLayer1KenBurns + 2) % 4;
        }

        previewLayer1Visible = !previewLayer1Visible;
      }, previewInterval) as any;
    } else if (backgroundType === 'slideshow' && slideshowImages.length === 1) {
      previewLayer1Image = slideshowImages[0];
      previewLayer1Visible = true;
    }

    return () => {
      if (previewIntervalId) {
        clearInterval(previewIntervalId);
      }
    };
  });
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={onCancel} onkeydown={(e) => e.key === 'Escape' && onCancel()}>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    aria-modal="true"
    aria-labelledby="background-config-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="background-config-title">Configure {level === 'dashboard' ? 'Dashboard' : 'Tab'} Background</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      <!-- Per-Tab Backgrounds Toggle (dashboard level only) - shown first -->
      {#if level === 'dashboard'}
        <div class="form-group toggle-group">
          <label class="toggle-label">
            <span class="toggle-switch" class:enabled={perTabEnabled}>
              <span class="toggle-knob"></span>
            </span>
            <span class="toggle-text">Individual backgrounds per tab</span>
            <input
              type="checkbox"
              bind:checked={perTabEnabled}
              class="toggle-checkbox"
            />
          </label>
          <p class="toggle-hint">
            {#if perTabEnabled}
              Each tab can have its own background. Edit a tab to configure it.
            {:else}
              All tabs share this dashboard background.
            {/if}
          </p>
        </div>
      {/if}

      <!-- Background Type Selection -->
      <div class="form-group">
        <label>Background Type {#if level === 'dashboard' && perTabEnabled}<span class="label-hint">(default for tabs without custom background)</span>{/if}</label>
        <div class="type-buttons">
          <button class="type-btn" class:active={backgroundType === 'none'} onclick={() => backgroundType = 'none'}>
            <Icon icon="mdi:close-circle-outline" width="24" />
            <span>None</span>
          </button>
          <button class="type-btn" class:active={backgroundType === 'color'} onclick={() => backgroundType = 'color'}>
            <Icon icon="mdi:palette" width="24" />
            <span>Color</span>
          </button>
          <button class="type-btn" class:active={backgroundType === 'image'} onclick={() => backgroundType = 'image'}>
            <Icon icon="mdi:image" width="24" />
            <span>Image</span>
          </button>
          <button class="type-btn" class:active={backgroundType === 'slideshow'} onclick={() => backgroundType = 'slideshow'}>
            <Icon icon="mdi:view-carousel" width="24" />
            <span>Slideshow</span>
          </button>
        </div>
      </div>

      <!-- Color Picker -->
      {#if backgroundType === 'color'}
        <div class="form-group">
          <label for="color">Background Color</label>
          <div class="color-row">
            <input id="color" type="color" bind:value={colorValue} class="color-input" />
            <input type="text" bind:value={colorValue} placeholder="#1e293b" class="color-text" />
          </div>
        </div>
      {/if}

      <!-- Image Fit Option -->
      {#if backgroundType === 'image' || backgroundType === 'slideshow'}
        <div class="form-group">
          <label>Image Fit</label>
          <div class="fit-buttons">
            <button class="fit-btn" class:active={backgroundFit === 'cover'} onclick={() => backgroundFit = 'cover'} title="Cover - Image covers entire area (may crop)">
              <Icon icon="mdi:arrow-expand-all" width="20" />
              <span>Cover</span>
            </button>
            <button class="fit-btn" class:active={backgroundFit === 'contain'} onclick={() => backgroundFit = 'contain'} title="Contain - Entire image visible (may have bars)">
              <Icon icon="mdi:fit-to-screen" width="20" />
              <span>Contain</span>
            </button>
            <button class="fit-btn" class:active={backgroundFit === 'fill'} onclick={() => backgroundFit = 'fill'} title="Fill - Stretch to fill (may distort)">
              <Icon icon="mdi:arrow-expand" width="20" />
              <span>Fill</span>
            </button>
          </div>
        </div>
      {/if}

      <!-- Single Image URL -->
      {#if backgroundType === 'image'}
        <div class="form-group">
          <label for="imageUrl">Image URL</label>
          <input id="imageUrl" type="text" bind:value={singleImageUrl} placeholder="https://example.com/image.jpg or /backgrounds/image.jpg" />
        </div>

        {#if singleImageUrl}
          <div class="preview">
            <img src={singleImageUrl} alt="Preview" />
          </div>
        {/if}
      {/if}

      <!-- Slideshow Configuration -->
      {#if backgroundType === 'slideshow'}
        <div class="form-group">
          <label for="interval">Rotation Interval (seconds)</label>
          <input id="interval" type="number" bind:value={slideshowInterval} min="5" max="300" step="5" />
        </div>

        <div class="form-group">
          <label>Transition Effect</label>
          <div class="transition-buttons">
            <button class="transition-btn" class:active={transitionEffect === 'crossfade'} onclick={() => transitionEffect = 'crossfade'} title="Crossfade">
              <Icon icon="mdi:blur" width="20" />
              <span>Crossfade</span>
            </button>
            <button class="transition-btn" class:active={transitionEffect === 'slide'} onclick={() => transitionEffect = 'slide'} title="Slide">
              <Icon icon="mdi:arrow-right-bold" width="20" />
              <span>Slide</span>
            </button>
            <button class="transition-btn" class:active={transitionEffect === 'zoom'} onclick={() => transitionEffect = 'zoom'} title="Zoom">
              <Icon icon="mdi:magnify-plus" width="20" />
              <span>Zoom</span>
            </button>
            <button class="transition-btn" class:active={transitionEffect === 'fade-black'} onclick={() => transitionEffect = 'fade-black'} title="Fade to Black">
              <Icon icon="mdi:circle" width="20" />
              <span>Fade Black</span>
            </button>
            <button class="transition-btn" class:active={transitionEffect === 'blur'} onclick={() => transitionEffect = 'blur'} title="Blur">
              <Icon icon="mdi:blur-radial" width="20" />
              <span>Blur</span>
            </button>
            <button class="transition-btn" class:active={transitionEffect === 'flip'} onclick={() => transitionEffect = 'flip'} title="Flip">
              <Icon icon="mdi:rotate-3d-variant" width="20" />
              <span>Flip</span>
            </button>
            <button class="transition-btn" class:active={transitionEffect === 'kenburns'} onclick={() => transitionEffect = 'kenburns'} title="Ken Burns">
              <Icon icon="mdi:movie" width="20" />
              <span>Ken Burns</span>
            </button>
            <button class="transition-btn" class:active={transitionEffect === 'none'} onclick={() => transitionEffect = 'none'} title="Instant">
              <Icon icon="mdi:flash" width="20" />
              <span>Instant</span>
            </button>
          </div>
        </div>

        <div class="form-group">
          <label for="transitionDuration">Transition Duration ({transitionDuration}s)</label>
          <input id="transitionDuration" type="range" bind:value={transitionDuration} min="0.5" max="5" step="0.5" class="range-input" disabled={transitionEffect === 'none'} />
          <div class="range-labels">
            <span>0.5s</span>
            <span>5s</span>
          </div>
        </div>

        <div class="form-group">
          <label>Selected Images ({slideshowImages.length})</label>
          {#if slideshowImages.length > 0}
            <div class="selected-images">
              {#each slideshowImages as imageUrl, index}
                <div class="selected-image">
                  <img src={imageUrl} alt="Slide {index + 1}" />
                  <button class="remove-btn" onclick={() => handleRemoveFromSlideshow(index)} title="Remove">
                    <Icon icon="mdi:close" width="16" />
                  </button>
                  <span class="image-index">{index + 1}</span>
                </div>
              {/each}
            </div>

            {#if slideshowImages.length > 1}
              <div class="transition-preview">
                <label><Icon icon="mdi:eye" width="16" /> Transition Preview ({transitionEffect})</label>
                <div class="preview-container">
                  <div
                    class="preview-layer layer-1 transition-{transitionEffect}"
                    class:visible={previewLayer1Visible}
                    class:kenburns-0={transitionEffect === 'kenburns' && previewLayer1KenBurns === 0}
                    class:kenburns-1={transitionEffect === 'kenburns' && previewLayer1KenBurns === 1}
                    class:kenburns-2={transitionEffect === 'kenburns' && previewLayer1KenBurns === 2}
                    class:kenburns-3={transitionEffect === 'kenburns' && previewLayer1KenBurns === 3}
                    style:background-image={previewLayer1Image ? `url(${previewLayer1Image})` : 'none'}
                    style:--transition-duration="{transitionDuration}s"
                  ></div>
                  <div
                    class="preview-layer layer-2 transition-{transitionEffect}"
                    class:visible={!previewLayer1Visible}
                    class:kenburns-0={transitionEffect === 'kenburns' && previewLayer2KenBurns === 0}
                    class:kenburns-1={transitionEffect === 'kenburns' && previewLayer2KenBurns === 1}
                    class:kenburns-2={transitionEffect === 'kenburns' && previewLayer2KenBurns === 2}
                    class:kenburns-3={transitionEffect === 'kenburns' && previewLayer2KenBurns === 3}
                    style:background-image={previewLayer2Image ? `url(${previewLayer2Image})` : 'none'}
                    style:--transition-duration="{transitionDuration}s"
                  ></div>
                </div>
              </div>
            {/if}
          {:else}
            <p class="empty-message">No images selected. Choose from the gallery below or upload your own.</p>
          {/if}
        </div>

        <!-- Custom URL Input -->
        <div class="form-group">
          <label>Add Custom Image URL</label>
          <div class="url-input-group">
            <input type="text" bind:value={customImageUrl} placeholder="https://example.com/image.jpg" onkeydown={(e) => e.key === 'Enter' && handleAddCustomUrl()} />
            <button onclick={handleAddCustomUrl} class="add-btn">
              <Icon icon="mdi:plus" width="20" />
              Add
            </button>
          </div>
        </div>
      {/if}

      <!-- Image Gallery (for image and slideshow) -->
      {#if backgroundType === 'image' || backgroundType === 'slideshow'}
        <div class="gallery-section">
          <div class="gallery-header">
            <h3>Image Gallery</h3>
            <!-- Upload Button -->
            <div class="upload-inline">
              <input
                bind:this={fileInput}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                onchange={handleFileUpload}
                class="file-input"
                id="bg-file-upload"
              />
              <label for="bg-file-upload" class="upload-btn">
                {#if isUploading}
                  <Icon icon="mdi:loading" width="20" class="spin" />
                {:else}
                  <Icon icon="mdi:cloud-upload" width="20" />
                {/if}
                Upload
              </label>
            </div>
          </div>

          {#if uploadError}
            <p class="upload-error">{uploadError}</p>
          {/if}

          <!-- Category Tabs -->
          <div class="category-tabs">
            {#each allCategories as category}
              <button
                class="category-tab"
                class:active={selectedCategory === category.id}
                onclick={() => selectedCategory = category.id}
              >
                <Icon icon={category.icon} width="18" />
                <span>{category.name}</span>
                {#if category.id !== 'all'}
                  <span class="count">({allImages.filter(img => img.category === category.id).length})</span>
                {/if}
              </button>
            {/each}
            <button
              class="category-tab add-category-btn"
              onclick={() => showNewCategoryInput = !showNewCategoryInput}
              title="Add custom category"
            >
              <Icon icon={showNewCategoryInput ? "mdi:close" : "mdi:plus"} width="18" />
            </button>
          </div>

          <!-- New Category Form -->
          {#if showNewCategoryInput}
            <div class="new-category-form">
              <input
                type="text"
                bind:value={newCategoryName}
                placeholder="Category name"
                class="new-category-input"
                onkeydown={(e) => e.key === 'Enter' && handleCreateCategory()}
              />
              <select bind:value={newCategoryIcon} class="icon-select">
                <option value="mdi:folder-image">Folder</option>
                <option value="mdi:image-multiple">Images</option>
                <option value="mdi:camera">Camera</option>
                <option value="mdi:landscape">Landscape</option>
                <option value="mdi:city">City</option>
                <option value="mdi:nature">Nature</option>
                <option value="mdi:water">Water</option>
                <option value="mdi:weather-night">Night</option>
                <option value="mdi:palette">Art</option>
                <option value="mdi:heart">Favorites</option>
                <option value="mdi:star">Featured</option>
                <option value="mdi:briefcase">Work</option>
              </select>
              <button onclick={handleCreateCategory} class="create-category-btn">
                <Icon icon="mdi:check" width="18" />
                Create
              </button>
            </div>
          {/if}

          <!-- Image Grid -->
          {#if isLoading}
            <div class="loading">
              <Icon icon="mdi:loading" width="32" class="spin" />
              <span>Loading images...</span>
            </div>
          {:else}
            <div class="image-grid">
              {#each filteredImages as image (image.id)}
                <button
                  class="image-card"
                  class:selected={backgroundType === 'image' ? singleImageUrl === image.url : slideshowImages.includes(image.url)}
                  onclick={() => handleToggleImage(image)}
                  onmouseenter={(e) => handleImageHover(e, image.url)}
                  onmouseleave={handleImageHoverEnd}
                  title={image.name}
                >
                  <img src={image.url} alt={image.name} loading="lazy" />
                  <div class="image-overlay">
                    {#if backgroundType === 'slideshow' && slideshowImages.includes(image.url)}
                      <Icon icon="mdi:minus-circle" width="32" />
                    {:else}
                      <Icon icon="mdi:plus-circle" width="32" />
                    {/if}
                    <span class="image-name">{image.name}</span>
                  </div>
                  {#if image.source === 'preset'}
                    <span class="preset-badge" title="Bundled preset">
                      <Icon icon="mdi:star" width="12" />
                    </span>
                  {/if}
                  {#if image.source === 'uploaded'}
                    <button
                      class="delete-btn"
                      onclick={(e) => { e.stopPropagation(); handleDeleteImage(image); }}
                      title="Delete"
                    >
                      <Icon icon="mdi:trash-can" width="16" />
                    </button>
                  {/if}
                  {#if (backgroundType === 'image' && singleImageUrl === image.url) || (backgroundType === 'slideshow' && slideshowImages.includes(image.url))}
                    <span class="selected-badge">
                      <Icon icon="mdi:check" width="14" />
                    </span>
                  {/if}
                </button>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn-secondary" onclick={onCancel}>Cancel</button>
      <button class="btn-primary" onclick={handleSave}>Save Background</button>
    </div>
  </div>
</div>

<!-- Hover preview -->
{#if hoverPreviewUrl}
  <div
    class="hover-preview"
    style:left="{hoverPreviewPosition.x}px"
    style:top="{hoverPreviewPosition.y}px"
  >
    <img src={hoverPreviewUrl} alt="Preview" />
  </div>
{/if}

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
    max-width: 1000px;
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

  /* Toggle switch styles */
  .toggle-group {
    padding: 1rem 1.25rem;
    background: var(--bg-tertiary);
    border-radius: 0.5rem;
    border: 1px solid var(--border);
  }

  .toggle-group .toggle-label {
    display: flex !important;
    align-items: center;
    gap: 1rem;
    cursor: pointer;
    margin-bottom: 0;
  }

  .toggle-checkbox {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
    pointer-events: none;
  }

  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 48px;
    min-width: 48px;
    height: 26px;
    background: var(--bg-secondary);
    border-radius: 13px;
    transition: background 0.2s, border-color 0.2s;
    flex-shrink: 0;
    border: 1px solid var(--border);
  }

  .toggle-knob {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    background: var(--text-secondary);
    border-radius: 50%;
    transition: transform 0.2s, background 0.2s;
  }

  .toggle-switch.enabled {
    background: var(--accent);
    border-color: var(--accent);
  }

  .toggle-switch.enabled .toggle-knob {
    transform: translateX(22px);
    background: white;
  }

  .toggle-text {
    font-weight: 500;
    color: var(--text-primary);
    line-height: 1.4;
  }

  .toggle-hint {
    margin: 0.75rem 0 0 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    padding-left: calc(48px + 1rem);
  }

  .label-hint {
    font-weight: 400;
    color: var(--text-secondary);
    font-size: 0.85rem;
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

  .type-buttons, .fit-buttons, .transition-buttons {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 0.5rem;
  }

  .type-btn, .fit-btn, .transition-btn {
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

  .type-btn:hover, .fit-btn:hover, .transition-btn:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .type-btn.active, .fit-btn.active, .transition-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .color-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .color-input {
    width: 80px;
    height: 44px;
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    cursor: pointer;
  }

  .color-text {
    flex: 1;
  }

  .range-input {
    width: 100%;
    height: 8px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--bg-tertiary);
    border-radius: 4px;
    outline: none;
  }

  .range-input::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .range-input:disabled {
    opacity: 0.5;
  }

  .range-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
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

  .selected-images {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 0.75rem;
  }

  .selected-image {
    position: relative;
    aspect-ratio: 16/9;
    border-radius: 0.375rem;
    overflow: hidden;
    border: 2px solid var(--border);
  }

  .selected-image img {
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

  .selected-image:hover .remove-btn {
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

  .gallery-section {
    margin-top: 2rem;
    padding-top: 2rem;
    border-top: 1px solid var(--border);
  }

  .gallery-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 1rem;
  }

  .gallery-header h3 {
    margin: 0;
    font-size: 1.125rem;
    font-weight: 600;
  }

  .upload-inline {
    position: relative;
  }

  .file-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
  }

  .upload-btn {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--accent);
    color: white;
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .upload-btn:hover {
    background: var(--accent-hover);
  }

  .upload-error {
    color: #ef4444;
    font-size: 0.875rem;
    margin-bottom: 1rem;
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
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.8rem;
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

  .category-tab .count {
    opacity: 0.7;
    font-size: 0.7rem;
  }

  .add-category-btn {
    padding: 0.5rem 0.625rem;
    background: transparent;
    border-style: dashed;
  }

  .add-category-btn:hover {
    background: var(--bg-primary);
    border-style: solid;
  }

  .new-category-form {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
    padding: 0.75rem;
    background: var(--bg-tertiary);
    border-radius: 0.375rem;
    border: 1px solid var(--border);
  }

  .new-category-input {
    flex: 1;
    min-width: 150px;
    padding: 0.5rem 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.875rem;
  }

  .new-category-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .icon-select {
    padding: 0.5rem 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    cursor: pointer;
  }

  .icon-select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .create-category-btn {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.5rem 0.75rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .create-category-btn:hover {
    background: var(--accent-hover);
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 2rem;
    color: var(--text-secondary);
  }

  .image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 0.75rem;
  }

  .image-card {
    position: relative;
    aspect-ratio: 16/9;
    border-radius: 0.5rem;
    overflow: hidden;
    border: 2px solid var(--border);
    background: var(--bg-tertiary);
    cursor: pointer;
    transition: all 0.2s;
  }

  .image-card:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
  }

  .image-card.selected {
    border-color: #22c55e;
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.3);
  }

  .image-card img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .image-overlay {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.25rem;
    opacity: 0;
    transition: opacity 0.2s;
    color: white;
  }

  .image-card:hover .image-overlay {
    opacity: 1;
  }

  .image-name {
    font-size: 0.75rem;
    font-weight: 500;
    text-align: center;
    padding: 0 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .preset-badge {
    position: absolute;
    top: 0.25rem;
    left: 0.25rem;
    background: #f59e0b;
    color: white;
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.625rem;
    display: flex;
    align-items: center;
  }

  .delete-btn {
    position: absolute;
    top: 0.375rem;
    right: 0.375rem;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    border: 2px solid white;
    cursor: pointer;
    background: #ef4444;
    color: white;
    opacity: 0;
    transition: all 0.2s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    padding: 0;
  }

  .image-card:hover .delete-btn {
    opacity: 1;
  }

  .delete-btn:hover {
    background: #dc2626;
    transform: scale(1.15);
  }

  .selected-badge {
    position: absolute;
    bottom: 0.25rem;
    right: 0.25rem;
    background: #22c55e;
    color: white;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .btn-secondary, .btn-primary {
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

  .spin {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  /* Transition preview styles */
  .transition-preview {
    margin-top: 1.5rem;
    padding: 1rem;
    background: var(--bg-primary);
    border-radius: 0.5rem;
    border: 1px solid var(--border);
  }

  .transition-preview label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.875rem;
    margin-bottom: 0.75rem;
  }

  .preview-container {
    position: relative;
    width: 100%;
    height: 180px;
    border-radius: 0.375rem;
    overflow: hidden;
    border: 2px solid var(--border);
  }

  .preview-layer {
    position: absolute;
    inset: 0;
    background-position: center;
    background-repeat: no-repeat;
    background-size: cover;
    opacity: 0;
  }

  .preview-layer.transition-crossfade {
    transition: opacity var(--transition-duration, 1.5s) cubic-bezier(0.4, 0, 0.2, 1);
  }

  .preview-layer.transition-crossfade.visible {
    opacity: 1;
  }

  .preview-layer.transition-slide {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: translateX(100%);
  }

  .preview-layer.transition-slide.visible {
    opacity: 1;
    transform: translateX(0);
  }

  .preview-layer.transition-zoom {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: scale(1.2);
  }

  .preview-layer.transition-zoom.visible {
    opacity: 1;
    transform: scale(1);
  }

  .preview-layer.transition-fade-black {
    transition: opacity calc(var(--transition-duration, 1.5s) / 2) ease-in-out;
  }

  .preview-layer.transition-fade-black.visible {
    opacity: 1;
    animation: fadeBlackPreview var(--transition-duration, 1.5s) ease-in-out;
  }

  @keyframes fadeBlackPreview {
    0% { opacity: 0; }
    40% { opacity: 0; }
    100% { opacity: 1; }
  }

  .preview-layer.transition-blur {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, filter var(--transition-duration, 1.5s) ease-in-out;
    filter: blur(20px);
  }

  .preview-layer.transition-blur.visible {
    opacity: 1;
    filter: blur(0px);
  }

  .preview-layer.transition-flip {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: perspective(1000px) rotateY(90deg);
    backface-visibility: hidden;
  }

  .preview-layer.transition-flip.visible {
    opacity: 1;
    transform: perspective(1000px) rotateY(0deg);
  }

  .preview-layer.transition-kenburns {
    transition: opacity 1.5s ease-in-out;
  }

  .preview-layer.transition-kenburns.visible {
    opacity: 1;
  }

  .preview-layer.transition-kenburns.kenburns-0 {
    animation: kenburns-preview-0 10s ease-in-out forwards;
  }

  @keyframes kenburns-preview-0 {
    0% { transform: scale(1.0) translate(0, 0); }
    100% { transform: scale(1.15) translate(-3%, -2%); }
  }

  .preview-layer.transition-kenburns.kenburns-1 {
    animation: kenburns-preview-1 10s ease-in-out forwards;
  }

  @keyframes kenburns-preview-1 {
    0% { transform: scale(1.0) translate(0, 0); }
    100% { transform: scale(1.15) translate(3%, 2%); }
  }

  .preview-layer.transition-kenburns.kenburns-2 {
    animation: kenburns-preview-2 10s ease-in-out forwards;
  }

  @keyframes kenburns-preview-2 {
    0% { transform: scale(1.15) translate(2%, -2%); }
    100% { transform: scale(1.0) translate(-2%, 2%); }
  }

  .preview-layer.transition-kenburns.kenburns-3 {
    animation: kenburns-preview-3 10s ease-in-out forwards;
  }

  @keyframes kenburns-preview-3 {
    0% { transform: scale(1.15) translate(-2%, 2%); }
    100% { transform: scale(1.0) translate(2%, -2%); }
  }

  .preview-layer.transition-none {
    transition: none;
  }

  .preview-layer.transition-none.visible {
    opacity: 1;
  }

  .preview-layer.layer-1 {
    z-index: 1;
  }

  .preview-layer.layer-2 {
    z-index: 2;
  }

  @media (max-width: 768px) {
    .modal-content {
      max-width: 100%;
      max-height: 100vh;
      border-radius: 0;
    }

    .image-grid {
      grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    }

    .category-tabs {
      overflow-x: auto;
      flex-wrap: nowrap;
      -webkit-overflow-scrolling: touch;
    }
  }

  /* Hover preview */
  .hover-preview {
    position: fixed;
    z-index: 2000;
    width: 300px;
    height: 200px;
    background: var(--bg-primary);
    border: 2px solid var(--accent);
    border-radius: 0.5rem;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
    overflow: hidden;
    pointer-events: none;
  }

  .hover-preview img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
</style>
