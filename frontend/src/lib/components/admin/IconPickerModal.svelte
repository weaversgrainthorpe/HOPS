<script lang="ts">
  import Icon from '@iconify/svelte';
  import ColoredIcon from '../ColoredIcon.svelte';
  import { getIconCategories, getIcons, createIcon, createIconCategory, deleteIcon, deleteIconCategory, uploadIconImage, type IconCategory, type Icon as IconType } from '$lib/utils/api';
  import { confirm } from '$lib/stores/confirmModal';
  import { toast } from '$lib/stores/toast';
  import { onMount } from 'svelte';
  import { focusTrap } from '$lib/utils/focusTrap';

  interface IconSelection {
    icon: string;
    imageUrl?: string;
  }

  interface Props {
    currentIcon?: string;
    currentImageUrl?: string;
    onSelect: (selection: IconSelection) => void;
    onCancel: () => void;
  }

  let { currentIcon, currentImageUrl, onSelect, onCancel }: Props = $props();

  let selectedCategory = $state('containers');
  let searchQuery = $state('');
  let categories = $state<IconCategory[]>([]);
  let icons = $state<IconType[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Add icon/category forms
  let showAddIcon = $state(false);
  let showAddCategory = $state(false);
  let newIconName = $state('');
  let newIconIcon = $state('');
  let newIconColor = $state('');
  let newIconImageUrl = $state('');
  let newIconUseUpload = $state(false);
  let uploadingIcon = $state(false);
  let newCategoryId = $state('');
  let newCategoryName = $state('');
  let newCategoryIcon = $state('');
  let saving = $state(false);
  let fileInput: HTMLInputElement;

  onMount(async () => {
    await loadData();
  });

  async function loadData() {
    try {
      loading = true;
      categories = await getIconCategories();
      icons = await getIcons();
      loading = false;
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load icons';
      loading = false;
    }
  }

  const categoryIcons = $derived(
    icons.filter(icon => icon.categoryId === selectedCategory)
  );

  const filteredIcons = $derived(
    searchQuery.trim()
      ? icons.filter(icon =>
          icon.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          icon.id.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : categoryIcons
  );

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (showAddIcon || showAddCategory) {
        showAddIcon = false;
        showAddCategory = false;
      } else {
        onCancel();
      }
    }
  }

  function handleSelectIcon(iconData: IconType) {
    onSelect({
      icon: iconData.icon,
      imageUrl: iconData.imageUrl
    });
  }

  async function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    if (!file) return;

    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      toast.error('Invalid file type. Use PNG, JPG, GIF, WebP, or SVG.');
      return;
    }

    // Validate file size (5MB max)
    if (file.size > 5 * 1024 * 1024) {
      toast.error('File too large. Maximum size is 5MB.');
      return;
    }

    try {
      uploadingIcon = true;
      const result = await uploadIconImage(file);
      newIconImageUrl = result.url;
      toast.success('Image uploaded!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      uploadingIcon = false;
    }
  }

  async function handleAddIcon() {
    if (!newIconName) return;

    // Must have either iconify icon or uploaded image
    if (!newIconUseUpload && !newIconIcon) {
      toast.error('Please enter an Iconify icon name');
      return;
    }
    if (newIconUseUpload && !newIconImageUrl) {
      toast.error('Please upload an image');
      return;
    }

    try {
      saving = true;
      const iconId = newIconName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
      await createIcon({
        id: iconId,
        name: newIconName,
        icon: newIconUseUpload ? '' : newIconIcon,
        categoryId: selectedCategory,
        color: newIconColor || undefined,
        imageUrl: newIconUseUpload ? newIconImageUrl : undefined
      });

      // Reload icons
      await loadData();

      // Reset form
      newIconName = '';
      newIconIcon = '';
      newIconColor = '';
      newIconImageUrl = '';
      newIconUseUpload = false;
      showAddIcon = false;
      toast.success('Icon added!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add icon');
    } finally {
      saving = false;
    }
  }

  async function handleAddCategory() {
    if (!newCategoryId || !newCategoryName || !newCategoryIcon) return;

    try {
      saving = true;
      await createIconCategory({
        id: newCategoryId,
        name: newCategoryName,
        icon: newCategoryIcon,
        order: categories.length
      });

      // Reload categories
      await loadData();

      // Reset form
      newCategoryId = '';
      newCategoryName = '';
      newCategoryIcon = '';
      showAddCategory = false;
      selectedCategory = newCategoryId;
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to add category');
    } finally {
      saving = false;
    }
  }

  async function handleDeleteIcon(iconId: string, isPreset: boolean) {
    if (isPreset) {
      toast.warning('Cannot delete preset icons');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete Icon',
      message: 'Are you sure you want to delete this icon?',
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!confirmed) return;

    try {
      await deleteIcon(iconId);
      await loadData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete icon');
    }
  }

  async function handleDeleteCategory(categoryId: string, isPreset: boolean) {
    if (isPreset) {
      toast.warning('Cannot delete preset categories');
      return;
    }

    const confirmed = await confirm({
      title: 'Delete Category',
      message: 'Delete this category and all its icons?',
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!confirmed) return;

    try {
      await deleteIconCategory(categoryId);
      await loadData();
      selectedCategory = 'containers';
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete category');
    }
  }
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
    aria-labelledby="icon-picker-title"
    tabindex="-1"
    use:focusTrap
  >
    <div class="modal-header">
      <h2 id="icon-picker-title">Choose an Icon</h2>
      <button class="close-btn" onclick={onCancel}>
        <Icon icon="mdi:close" width="24" />
      </button>
    </div>

    <div class="modal-body">
      {#if loading}
        <div class="loading-message">
          Loading icons...
        </div>
      {:else if error}
        <div class="error-message">
          {error}
        </div>
      {:else}
        <!-- Search Bar -->
        <div class="search-bar">
          <Icon icon="mdi:magnify" width="20" />
          <input
            type="text"
            bind:value={searchQuery}
            placeholder="Search icons..."
            class="search-input"
          />
        </div>

        <!-- Category Tabs (hidden when searching) -->
        {#if !searchQuery.trim()}
          <div class="category-tabs">
            {#each categories as category}
              <button
                class="category-tab"
                class:active={selectedCategory === category.id}
                onclick={() => selectedCategory = category.id}
              >
                <Icon icon={category.icon} width="20" />
                <span>{category.name}</span>
                {#if !category.isPreset}
                  <button
                    class="delete-category-btn"
                    onclick={(e) => { e.stopPropagation(); handleDeleteCategory(category.id, category.isPreset); }}
                    title="Delete category"
                  >
                    <Icon icon="mdi:close" width="14" />
                  </button>
                {/if}
              </button>
            {/each}
            <button
              class="category-tab add-category-tab"
              onclick={() => showAddCategory = !showAddCategory}
              title="Add new category"
            >
              <Icon icon="mdi:plus" width="20" />
              <span>Add Category</span>
            </button>
          </div>
        {/if}

        <!-- Add Category Form -->
        {#if showAddCategory}
          <div class="add-form">
            <h3>Add New Category</h3>
            <div class="form-row">
              <input
                type="text"
                bind:value={newCategoryId}
                placeholder="ID (e.g., custom)"
                class="form-input"
              />
              <input
                type="text"
                bind:value={newCategoryName}
                placeholder="Name (e.g., Custom)"
                class="form-input"
              />
            </div>
            <div class="form-row">
              <input
                type="text"
                bind:value={newCategoryIcon}
                placeholder="Icon (e.g., mdi:star)"
                class="form-input"
              />
            </div>
            <div class="form-actions">
              <button class="btn-secondary" onclick={() => showAddCategory = false}>Cancel</button>
              <button class="btn-primary" onclick={handleAddCategory} disabled={saving || !newCategoryId || !newCategoryName || !newCategoryIcon}>
                {saving ? 'Adding...' : 'Add Category'}
              </button>
            </div>
          </div>
        {/if}

        <!-- Add Icon Button -->
        {#if !searchQuery.trim() && !showAddCategory}
          <div class="toolbar">
            <button class="btn-add-icon" onclick={() => showAddIcon = !showAddIcon}>
              <Icon icon="mdi:plus" width="18" />
              Add Icon to {categories.find(c => c.id === selectedCategory)?.name || 'Category'}
            </button>
          </div>
        {/if}

        <!-- Add Icon Form -->
        {#if showAddIcon}
          <div class="add-form">
            <h3>Add New Icon</h3>
            <div class="form-row">
              <input
                type="text"
                bind:value={newIconName}
                placeholder="Name (e.g., My Service)"
                class="form-input"
              />
            </div>

            <!-- Icon Type Toggle -->
            <div class="icon-type-toggle">
              <button
                class="toggle-btn"
                class:active={!newIconUseUpload}
                onclick={() => newIconUseUpload = false}
              >
                <Icon icon="mdi:palette" width="16" />
                Iconify
              </button>
              <button
                class="toggle-btn"
                class:active={newIconUseUpload}
                onclick={() => newIconUseUpload = true}
              >
                <Icon icon="mdi:upload" width="16" />
                Upload Image
              </button>
            </div>

            {#if newIconUseUpload}
              <!-- Upload Image -->
              <div class="upload-section">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  onchange={handleFileUpload}
                  bind:this={fileInput}
                  class="file-input"
                  id="icon-upload"
                />
                <label for="icon-upload" class="upload-btn">
                  {#if uploadingIcon}
                    <Icon icon="mdi:loading" width="20" class="spin" />
                    Uploading...
                  {:else if newIconImageUrl}
                    <img src={newIconImageUrl} alt="Uploaded icon" class="upload-preview" />
                    <span>Change Image</span>
                  {:else}
                    <Icon icon="mdi:cloud-upload" width="24" />
                    <span>Choose PNG, SVG, or JPG</span>
                  {/if}
                </label>
                <small class="help-text-inline">Max 5MB. Will be resized to 128x128.</small>
              </div>
            {:else}
              <!-- Iconify Input -->
              <div class="form-row">
                <input
                  type="text"
                  bind:value={newIconIcon}
                  placeholder="Iconify Icon (e.g., mdi:server or simple-icons:docker)"
                  class="form-input"
                />
              </div>
              <div class="form-row">
                <input
                  type="text"
                  bind:value={newIconColor}
                  placeholder="Color (optional, e.g., #FF5733)"
                  class="form-input"
                />
              </div>
              <small class="help-text-inline">
                Find icons at <a href="https://icon-sets.iconify.design/" target="_blank" rel="noopener">iconify.design</a>
              </small>
            {/if}

            <div class="form-actions">
              <button class="btn-secondary" onclick={() => { showAddIcon = false; newIconUseUpload = false; newIconImageUrl = ''; }}>Cancel</button>
              <button
                class="btn-primary"
                onclick={handleAddIcon}
                disabled={saving || !newIconName || (newIconUseUpload ? !newIconImageUrl : !newIconIcon)}
              >
                {saving ? 'Adding...' : 'Add Icon'}
              </button>
            </div>
          </div>
        {/if}

        <!-- Icon Grid -->
        <div class="icon-grid">
          {#each filteredIcons as iconData}
            <button
              class="icon-card"
              class:selected={currentIcon === iconData.icon || currentImageUrl === iconData.imageUrl}
              onclick={() => handleSelectIcon(iconData)}
              title={iconData.name}
            >
              {#if !iconData.isPreset}
                <button
                  class="delete-icon-btn"
                  onclick={(e) => { e.stopPropagation(); handleDeleteIcon(iconData.id, iconData.isPreset); }}
                  title="Delete icon"
                >
                  <Icon icon="mdi:close" width="12" />
                </button>
              {/if}
              <div class="icon-preview">
                {#if iconData.imageUrl}
                  <img src={iconData.imageUrl} alt={iconData.name} class="icon-image" />
                {:else}
                  <ColoredIcon icon={iconData.icon} width="48" color={iconData.color} />
                {/if}
              </div>
              <div class="icon-name">{iconData.name}</div>
            </button>
          {/each}
        </div>

        {#if filteredIcons.length === 0}
          <div class="empty-message">
            No icons found matching "{searchQuery}"
          </div>
        {/if}
      {/if}
    </div>

    <div class="modal-footer">
      <div class="footer-help">
        <Icon icon="mdi:information-outline" width="16" />
        <span>Click an icon to select it. Add custom icons and categories on-the-fly!</span>
      </div>
      <button class="btn-secondary" onclick={onCancel}>Cancel</button>
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
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .modal-header h2 {
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    padding: 0.5rem;
    border-radius: 0.375rem;
    transition: all 0.2s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .close-btn:hover {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--text-primary);
    font-size: 1rem;
    outline: none;
  }

  .search-input::placeholder {
    color: var(--text-secondary);
  }

  .category-tabs {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding-bottom: 0.5rem;
    border-bottom: 1px solid var(--border);
  }

  .category-tab {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    font-size: 0.875rem;
    font-weight: 500;
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

  .icon-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 1rem;
  }

  .icon-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--bg-tertiary);
    border: 2px solid var(--border);
    border-radius: 0.5rem;
    cursor: pointer;
    transition: all 0.2s;
    text-align: center;
  }

  .icon-card:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  }

  .icon-card.selected {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .icon-preview {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent);
  }

  .icon-card.selected .icon-preview {
    color: white;
  }

  .icon-name {
    font-size: 0.75rem;
    font-weight: 500;
    color: var(--text-secondary);
    word-break: break-word;
  }

  .icon-card.selected .icon-name {
    color: white;
  }

  .empty-message {
    text-align: center;
    padding: 3rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
  }

  .loading-message,
  .error-message {
    text-align: center;
    padding: 3rem;
    font-size: 0.875rem;
  }

  .loading-message {
    color: var(--text-secondary);
  }

  .error-message {
    color: var(--error, #ef4444);
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    padding: 1.5rem;
    border-top: 1px solid var(--border);
  }

  .footer-help {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
  }

  .btn-secondary {
    padding: 0.75rem 1.5rem;
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    color: var(--text-primary);
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-secondary:hover {
    background: var(--bg-primary);
    border-color: var(--accent);
  }

  .add-category-tab {
    background: var(--bg-tertiary);
    border: 1px dashed var(--border);
    color: var(--text-secondary);
  }

  .add-category-tab:hover {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .delete-category-btn {
    margin-left: auto;
    padding: 0.25rem;
    background: transparent;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    border-radius: 0.25rem;
    opacity: 0;
    transition: all 0.2s;
  }

  .category-tab:hover .delete-category-btn {
    opacity: 1;
  }

  .delete-category-btn:hover {
    background: rgba(239, 68, 68, 0.1);
    color: #ef4444;
  }

  .delete-icon-btn {
    position: absolute;
    top: 0.25rem;
    right: 0.25rem;
    padding: 0.25rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    color: var(--text-secondary);
    cursor: pointer;
    opacity: 0;
    transition: all 0.2s;
  }

  .icon-card:hover .delete-icon-btn {
    opacity: 1;
  }

  .delete-icon-btn:hover {
    background: #ef4444;
    border-color: #ef4444;
    color: white;
  }

  .toolbar {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0;
  }

  .btn-add-icon {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--accent);
    border: none;
    border-radius: 0.5rem;
    color: white;
    font-weight: 500;
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-add-icon:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  .add-form {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    padding: 1.5rem;
    margin-bottom: 1rem;
  }

  .add-form h3 {
    margin: 0 0 1rem 0;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .form-row {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .form-input {
    flex: 1;
    padding: 0.75rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-primary);
    font-size: 0.875rem;
    outline: none;
    transition: all 0.2s;
  }

  .form-input:focus {
    border-color: var(--accent);
  }

  .form-input::placeholder {
    color: var(--text-secondary);
  }

  .help-text-inline {
    display: block;
    margin-bottom: 0.75rem;
    color: var(--text-secondary);
    font-size: 0.75rem;
  }

  .help-text-inline a {
    color: var(--accent);
    text-decoration: none;
  }

  .help-text-inline a:hover {
    text-decoration: underline;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    margin-top: 1rem;
  }

  .btn-primary {
    padding: 0.75rem 1.5rem;
    background: var(--accent);
    border: none;
    border-radius: 0.375rem;
    color: white;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .btn-primary:hover:not(:disabled) {
    opacity: 0.9;
  }

  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon-card {
    position: relative;
  }

  .icon-image {
    width: 48px;
    height: 48px;
    object-fit: contain;
    border-radius: 0.25rem;
  }

  .icon-type-toggle {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .toggle-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.625rem 1rem;
    background: var(--bg-primary);
    border: 1px solid var(--border);
    border-radius: 0.375rem;
    color: var(--text-secondary);
    font-size: 0.875rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }

  .toggle-btn:hover {
    border-color: var(--accent);
    color: var(--text-primary);
  }

  .toggle-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }

  .upload-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .file-input {
    display: none;
  }

  .upload-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 1.5rem;
    background: var(--bg-primary);
    border: 2px dashed var(--border);
    border-radius: 0.5rem;
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.2s;
    min-height: 100px;
  }

  .upload-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .upload-preview {
    width: 64px;
    height: 64px;
    object-fit: contain;
    border-radius: 0.375rem;
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }
</style>
