<script lang="ts" module>
  /** Per-level wording (design §4a, §7.1). The dialog title lives here; the on/off wording is in the markup. */
  export const LEVEL_TEXT = {
    dashboard: { title: 'Dashboard background' },
    tab: { title: 'Tab background' },
    folder: { title: 'Folder background' }
  } as const;
</script>

<script lang="ts">
  /**
   * The background picker's form (design §4a): inherit, type, fit, opacity, overlay, slideshow and
   * the image gallery. Hosted by BackgroundConfigModal (tab and folder levels) and by the dashboard
   * dialog's Background section (walkthrough §4C); the host reads the result with `build()`.
   */
  import type { Background } from '$lib/types';
  import Icon from '@iconify/svelte';
  import { BACKGROUND_PRESETS, BACKGROUND_CATEGORIES, type BackgroundImage, type BackgroundCategory } from '$lib/constants/backgrounds';
  import { getBackgrounds, uploadBackground, deleteBackground, createBackgroundCategory } from '$lib/utils/api';
  import { confirm } from '$lib/stores/confirmModal';
  import { untrack } from 'svelte';
  import { logError } from '$lib/utils/errors';
  import { isSafeBackgroundUrl, cssUrl } from '$lib/components/background/backgroundUrl';
  import { galleryImages } from '$lib/components/background/galleryImages';
  import { folderColourFromBackground } from '$lib/components/background/legacyFolderColour';
  import {
    slideshowInterval as clampInterval,
    slideshowTransitionDuration as clampDuration,
    INTERVAL_MIN,
    INTERVAL_MAX,
    DURATION_MIN,
    DURATION_MAX
  } from '$lib/components/background/backgroundTiming';

  interface Props {
    background?: Background;
    /** Which level this picker edits (design §4a): folders get no overlay or blur of their own. */
    level: 'dashboard' | 'tab' | 'folder';
    /**
     * Folder level, a stored colour background (M6 §7.5): "Use as folder colour" hands it to the folder
     * dialog, which owns the folder's colour. Without it the button is not offered.
     */
    onUseAsFolderColour?: () => void;
  }

  let { background, level, onUseAsFolderColour }: Props = $props();

  /** The slideshow limit the server's document rules enforce. */
  const MAX_IMAGES = 200;
  const hasOverlay = $derived(level !== 'folder');
  // svelte-ignore state_referenced_locally
  const isFolder = level === 'folder';
  // M6 §7.5: a folder background is pictures only (Edit Folder owns the colour). A colour background
  // stored before that keeps rendering and is shown as its own choice — never dropped silently.
  // svelte-ignore state_referenced_locally
  const legacyColour = isFolder && background?.type === 'color';
  // svelte-ignore state_referenced_locally
  const legacyColourUse = legacyColour ? folderColourFromBackground(background) : null;
  /** Folder level: no picture of its own (what's behind shows), its own picture, or the stored colour. */
  // svelte-ignore state_referenced_locally
  let folderChoice = $state<'behind' | 'picture' | 'colour'>(
    legacyColour ? 'colour'
    : background?.inherit === true || !(background?.type === 'image' || background?.type === 'slideshow') ? 'behind'
    : 'picture'
  );

  function chooseFolder(c: 'behind' | 'picture' | 'colour') {
    folderChoice = c;
    if (c === 'behind') {
      inheritOn = true;
      // A colour is not a picture to keep: choosing "No picture" removes it (said before Save).
      if (backgroundType === 'color') backgroundType = 'none';
    } else if (c === 'picture') {
      inheritOn = false;
      if (!keptPicture) backgroundType = 'image';
    } else {
      inheritOn = stored.inherit === true;
      backgroundType = 'color';
    }
  }

  const clamp01 = (n: unknown, d: number) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;

  // Inherit keeps the stored picture (call 5): the form below still holds it.
  // svelte-ignore state_referenced_locally
  let inheritOn = $state(background?.inherit === true);
  // One show-through opacity per level (call 2), 0–1, default 1.
  // svelte-ignore state_referenced_locally
  let surfaceOpacity = $state(clamp01(background?.opacity, 1));

  // Form state initialized from props (intentionally captures initial values)
  // svelte-ignore state_referenced_locally
  let backgroundType = $state<'none' | 'color' | 'image' | 'slideshow'>(
    background?.type || 'none'
  );
  /** The picture controls: always at the dashboard and tab levels; at folder level, for "Its own picture". */
  const showPictureControls = $derived(!isFolder || folderChoice === 'picture');
  const keptPicture = $derived(backgroundType === 'image' || backgroundType === 'slideshow');
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
  let slideshowInterval = $state(clampInterval(background?.interval));
  // svelte-ignore state_referenced_locally
  let transitionEffect = $state<'crossfade' | 'slide' | 'slide-up' | 'slide-down' | 'zoom' | 'zoom-out' | 'fade-black' | 'blur' | 'flip' | 'swirl' | 'wipe' | 'curtain' | 'circle' | 'diamond' | 'dissolve' | 'flash' | 'glitch' | 'kenburns' | 'random' | 'none'>(background?.transition || 'crossfade');

  // Same pool used by BackgroundLayer when 'random' is selected.
  const availableTransitions = [
    'crossfade', 'slide', 'slide-up', 'slide-down', 'zoom', 'zoom-out',
    'fade-black', 'blur', 'flip', 'kenburns', 'wipe', 'swirl',
    'dissolve', 'flash', 'glitch', 'curtain', 'circle', 'diamond'
  ];
  let currentRandomTransition = $state(availableTransitions[Math.floor(Math.random() * availableTransitions.length)]);
  // Resolves 'random' to a concrete transition for the preview render.
  // Without this the preview was applying class transition-random, which
  // has no CSS rule, so nothing animated.
  let effectiveTransition = $derived(transitionEffect === 'random' ? currentRandomTransition : transitionEffect);
  // svelte-ignore state_referenced_locally
  let transitionDuration = $state(clampDuration(background?.transitionDuration));
  // Ruling 14: a stored timing outside the bounds is shown clamped and saved clamped — and the
  // picker says so (never a silent change).
  // svelte-ignore state_referenced_locally
  const intervalNormalised =
    background?.type === 'slideshow' && background.interval !== undefined && background.interval !== slideshowInterval
      ? String(background.interval) : null;
  // svelte-ignore state_referenced_locally
  const durationNormalised =
    background?.type === 'slideshow' && background.transitionDuration !== undefined && background.transitionDuration !== transitionDuration
      ? String(background.transitionDuration) : null;
  // svelte-ignore state_referenced_locally
  let overlayOpacity = $state(background?.overlayOpacity ?? 0.7);
  // svelte-ignore state_referenced_locally
  let overlayBlur = $state(background?.overlayBlur ?? 10);

  // Exact round trip: Save starts from the stored background (unknown keys and
  // fields the current type doesn't use are kept) and writes only what the form
  // changed — so opening and saving without a change gives back an equal object.
  // svelte-ignore state_referenced_locally
  const stored: Readonly<Background> = background ? JSON.parse(JSON.stringify(background)) : {};
  // Read once, on open (untrack: a snapshot, not a dependency).
  const initial = untrack(() => ({
    type: backgroundType,
    fit: backgroundFit,
    opacity: surfaceOpacity,
    color: colorValue,
    image: singleImageUrl,
    images: [...slideshowImages],
    interval: slideshowInterval,
    transition: transitionEffect,
    transitionDuration,
    overlayOpacity,
    overlayBlur
  }));
  /** Saved slideshow entries the renderer would refuse (legacy data): shown, never re-saved silently. */
  const unsafeImages = $derived(slideshowImages.filter((u) => !isSafeBackgroundUrl(u)));
  let selectedCategory = $state('all');
  let customImageUrl = $state('');
  // Visible problems (no silent failures): a refused custom URL, a failed library load. (A refused
  // Save is the host's to show: build() returns it.)
  let customUrlError = $state('');
  let loadError = $state('');
  const URL_RULE = "That URL can't be used as a background: use an http(s) address, or an uploaded or bundled image (/backgrounds/… or /presets/…).";
  const singleUrlBad = $derived(singleImageUrl.trim() !== '' && !isSafeBackgroundUrl(singleImageUrl.trim()));

  // Animation preview state
  let previewIndex = $state(0);
  let previewLayer1Visible = $state(true);
  let previewLayer1Image = $state('');
  let previewLayer2Image = $state('');
  let previewIntervalId: ReturnType<typeof setInterval> | undefined;
  let previewLayer1KenBurns = $state(0);
  let previewLayer2KenBurns = $state(1);
  // For curtain effect - track the previous image for the splitting overlay
  let curtainPreviousImage = $state('');
  let curtainAnimating = $state(false);

  // Unified image data
  let categories = $state<BackgroundCategory[]>([]);
  let allImages = $state<BackgroundImage[]>([]);
  let isLoading = $state(true);
  let isUploading = $state(false);
  let uploadError = $state('');
  let fileInput = $state<HTMLInputElement | null>(null);

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
      const data = await getBackgrounds();
      categories = data.categories || BACKGROUND_CATEGORIES;

      // Merge server images with presets
      const serverImages: BackgroundImage[] = data.images || [];
      const serverUrls = new Set(serverImages.map((img: BackgroundImage) => img.url));

      // Add presets that aren't already in server data
      const presetsToAdd = BACKGROUND_PRESETS
        .filter(p => !serverUrls.has(p.url))
        .map(p => ({ ...p, source: 'preset' as const }));

      allImages = [...serverImages, ...presetsToAdd];
    } catch (error) {
      logError('Background load', error);
      // Fallback to local presets, saying so (the user's uploads are missing from the gallery).
      loadError = `Couldn't load your uploaded images (${(error as Error)?.message ?? 'unknown error'}); showing the bundled presets only.`;
      categories = BACKGROUND_CATEGORIES;
      allImages = BACKGROUND_PRESETS.map(p => ({ ...p, source: 'preset' as const }));
    }
    isLoading = false;
  }

  // Filter images by category; each picture (URL) appears once per view (walkthrough §1)
  let filteredImages = $derived(galleryImages(allImages, selectedCategory));

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

      try {
        const category = selectedCategory === 'all' ? 'uploaded' : selectedCategory;
        const result = await uploadBackground(file, category);

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

    const displayName = image.name?.trim() || 'this background';
    const confirmed = await confirm({
      title: `Delete "${displayName}"?`,
      message: 'The image will be removed from your library and from any dashboards or tabs that use it.',
      confirmText: 'Delete',
      confirmStyle: 'danger'
    });
    if (!confirmed) return;

    try {
      await deleteBackground(image.id);
      allImages = allImages.filter(img => img.id !== image.id);
      slideshowImages = slideshowImages.filter(url => url !== image.url);
      if (singleImageUrl === image.url) {
        singleImageUrl = '';
      }
    } catch (error) {
      logError('Background delete', error);
      const message = (error as Error).message;
      if (message.includes('401')) {
        uploadError = 'Session expired. Please log in again at /admin';
      } else {
        uploadError = `Failed to delete: ${message}`;
      }
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
    const url = customImageUrl.trim();
    if (!url) return;
    // The same rule the renderer uses: a URL it would refuse is never stored.
    if (!isSafeBackgroundUrl(url)) {
      customUrlError = URL_RULE;
      return;
    }
    if (backgroundType === 'slideshow' && !slideshowImages.includes(url) && slideshowImages.length >= MAX_IMAGES) {
      customUrlError = `A slideshow can have at most ${MAX_IMAGES} images.`;
      return;
    }
    customUrlError = '';

    if (backgroundType === 'slideshow') {
      if (!slideshowImages.includes(url)) {
        slideshowImages = [...slideshowImages, url];
      }
    } else if (backgroundType === 'image') {
      singleImageUrl = url;
    }
    customImageUrl = '';
  }

  async function handleCreateCategory() {
    if (!newCategoryName.trim()) return;

    const categoryId = newCategoryName.trim().toLowerCase().replace(/\s+/g, '-');

    try {
      const newCategory: BackgroundCategory = {
        id: categoryId,
        name: newCategoryName.trim(),
        icon: newCategoryIcon
      };
      await createBackgroundCategory(newCategory);
      categories = [...categories, newCategory];
      newCategoryName = '';
      newCategoryIcon = 'mdi:folder-image';
      showNewCategoryInput = false;
      selectedCategory = categoryId;
    } catch (error) {
      uploadError = `Failed to create category: ${(error as Error).message}`;
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

  /** The picture the form describes (undefined for None), or a reason it can't be saved. */
  function buildPicture(): { bg?: Background; problem?: string } {
    // None, untouched, on a stored form with no type (e.g. the bare inherit form): keep it as is.
    const base: Background = { ...stored };
    delete base.inherit;
    if (backgroundType === 'none') {
      return initial.type === 'none' && Object.keys(base).length > 0 ? { bg: base } : {};
    }

    const out: Background = base;
    const typeChanged = backgroundType !== initial.type;
    // The form owns a field when the user changed it, or when the type changed (then every
    // field the new type uses comes from the form). Fields the type doesn't use are kept.
    const owns = (changed: boolean) => typeChanged || changed;
    out.type = backgroundType as 'color' | 'image' | 'slideshow';
    if (owns(backgroundFit !== initial.fit)) out.fit = backgroundFit;
    const op = clamp01(Number(surfaceOpacity), 1);
    // Write the opacity when the user moved it, or when the stored value needed clamping.
    if (op !== initial.opacity || (stored.opacity !== undefined && stored.opacity !== op)) out.opacity = op;

    if (backgroundType === 'color') {
      if (owns(colorValue !== initial.color)) out.value = colorValue;
    } else if (backgroundType === 'image') {
      const url = singleImageUrl.trim();
      if (!url) return { problem: 'Choose an image from the gallery, or enter its URL.' };
      if (!isSafeBackgroundUrl(url)) return { problem: URL_RULE };
      if (owns(singleImageUrl !== initial.image)) out.value = url;
    } else if (backgroundType === 'slideshow') {
      if (slideshowImages.length === 0) return { problem: 'A slideshow needs at least one image.' };
      if (slideshowImages.length > MAX_IMAGES) return { problem: `A slideshow can have at most ${MAX_IMAGES} images.` };
      if (unsafeImages.length > 0) {
        return { problem: `${unsafeImages.length} saved slideshow ${unsafeImages.length === 1 ? 'image' : 'images'} can't be used (marked below); remove ${unsafeImages.length === 1 ? 'it' : 'them'} to save.` };
      }
      const imagesChanged =
        slideshowImages.length !== initial.images.length || slideshowImages.some((u, i) => u !== initial.images[i]);
      if (owns(imagesChanged)) out.images = [...slideshowImages];
      // Clamped (Ruling 14); written when changed, or when the stored value needed clamping.
      slideshowInterval = clampInterval(Number(slideshowInterval));
      transitionDuration = clampDuration(Number(transitionDuration));
      if (owns(slideshowInterval !== initial.interval) || intervalNormalised !== null) out.interval = slideshowInterval;
      if (owns(transitionEffect !== initial.transition)) out.transition = transitionEffect;
      if (owns(transitionDuration !== initial.transitionDuration) || durationNormalised !== null) {
        out.transitionDuration = transitionDuration;
      }
    }
    // Folders have no overlay or blur of their own (call 1): the picker never writes them there.
    if (hasOverlay && (backgroundType === 'image' || backgroundType === 'slideshow')) {
      if (owns(overlayOpacity !== initial.overlayOpacity)) out.overlayOpacity = overlayOpacity;
      if (owns(overlayBlur !== initial.overlayBlur)) out.overlayBlur = overlayBlur;
    }
    return { bg: out };
  }

  /**
   * What Save stores: the background the form describes (undefined = none of this level's own), or
   * the reason it can't be saved. The kept picture is checked even while Inherit is on, so turning
   * Inherit off later never brings back something unusable (and nothing is dropped silently).
   */
  export function build(): { ok: true; value: Background | undefined } | { ok: false; problem: string } {
    if (isFolder) {
      // The stored colour background, untouched: kept exactly (switched on or off).
      if (folderChoice === 'colour') return { ok: true, value: background ? { ...stored } : undefined };
      // No picture of its own and none kept: the bare inherit form round-trips; otherwise nothing.
      if (folderChoice === 'behind' && !keptPicture) {
        const bare = stored.inherit === true && !stored.type;
        return { ok: true, value: bare ? { ...stored } : undefined };
      }
    }
    const { bg, problem } = buildPicture();
    if (problem) return { ok: false, problem: inheritOn ? `The kept picture can't be saved: ${problem}` : problem };
    // Off but kept (call 5): { inherit: true, …picture }; None + Inherit = the bare inherit form.
    if (inheritOn) return { ok: true, value: bg ? { ...bg, inherit: true } : { inherit: true } };
    // None without Inherit = no background of this level's own.
    return { ok: true, value: backgroundType === 'none' ? undefined : bg };
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
      curtainPreviousImage = slideshowImages[0];

      const previewInterval = 5000;
      previewIntervalId = setInterval(() => {
        // For curtain effect, capture the current image before switching
        const currentImage = previewLayer1Visible ? previewLayer1Image : previewLayer2Image;

        // If 'random' is selected, pick a new concrete transition for this cycle.
        // Must do this BEFORE checking effectiveTransition below so the curtain
        // detection picks up the freshly-rolled value.
        if (transitionEffect === 'random') {
          currentRandomTransition = availableTransitions[Math.floor(Math.random() * availableTransitions.length)];
        }

        previewIndex = (previewIndex + 1) % slideshowImages.length;
        const nextImage = slideshowImages[previewIndex];

        if (previewLayer1Visible) {
          previewLayer2Image = nextImage;
          previewLayer2KenBurns = (previewLayer2KenBurns + 2) % 4;
        } else {
          previewLayer1Image = nextImage;
          previewLayer1KenBurns = (previewLayer1KenBurns + 2) % 4;
        }

        // Trigger curtain animation if curtain effect is currently in use
        // (configured directly OR rolled by random this cycle).
        if (effectiveTransition === 'curtain') {
          curtainPreviousImage = currentImage;
          curtainAnimating = true;
          setTimeout(() => {
            curtainAnimating = false;
          }, clampDuration(transitionDuration) * 1000);
        }

        previewLayer1Visible = !previewLayer1Visible;
      }, previewInterval);
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

<!-- On/off, in plain words per level (§7.1). Off but kept (call 5): the picture below stays stored
     while the parent's shows. Data: { inherit: true, …picture }. -->
<div class="form-group toggle-group">
  {#if level === 'dashboard'}
    <label class="toggle-label">
      <span class="toggle-switch" class:enabled={!inheritOn} aria-hidden="true">
        <span class="toggle-knob"></span>
      </span>
      <span class="toggle-text">Show background picture</span>
      <input
        type="checkbox"
        role="switch"
        aria-checked={!inheritOn}
        aria-describedby="bg-inherit-hint"
        checked={!inheritOn}
        onchange={(e) => (inheritOn = !e.currentTarget.checked)}
        class="toggle-checkbox"
      />
    </label>
    <p class="toggle-hint" id="bg-inherit-hint">
      {#if inheritOn}
        No picture. Your chosen picture is kept, so turning this back on restores it.
      {:else}
        Shown behind the whole dashboard.
      {/if}
    </p>
  {:else if isFolder}
    <!-- M6 §7.5: pictures only. The folder's colour and opacity are set in Edit Folder. -->
    <div class="inherit-radios" role="radiogroup" aria-label="Folder background">
      {#if legacyColour}
        <label class="inherit-radio">
          <input type="radio" name="bg-source" checked={folderChoice === 'colour'} onchange={() => chooseFolder('colour')} />
          <span>Colour background (set the folder colour instead)</span>
        </label>
      {/if}
      <label class="inherit-radio">
        <input type="radio" name="bg-source" checked={folderChoice === 'behind'} onchange={() => chooseFolder('behind')} />
        <span>No picture of its own — show what's behind</span>
      </label>
      <label class="inherit-radio">
        <input type="radio" name="bg-source" checked={folderChoice === 'picture'} onchange={() => chooseFolder('picture')} />
        <span>Its own picture</span>
      </label>
    </div>
    {#if folderChoice === 'colour'}
      <div class="legacy-colour" data-legacy-colour>
        <span class="legacy-swatch" style:background-color={legacyColourUse?.ok ? legacyColourUse.color : undefined} aria-hidden="true"></span>
        <p class="radio-hint-text">
          This folder has a colour background ({background?.value ?? 'no value'}){background?.inherit ? ', switched off' : ''}.
          Folders take their colour from Edit Folder now; it keeps showing until you change it.
        </p>
        {#if legacyColourUse && !legacyColourUse.ok}
          <p class="radio-hint-text">{legacyColourUse.problem}</p>
        {:else if onUseAsFolderColour}
          <button type="button" class="use-colour-btn" onclick={() => onUseAsFolderColour?.()}>Use as folder colour</button>
        {/if}
      </div>
    {:else if folderChoice === 'behind' && legacyColour}
      <p class="toggle-hint radio-hint" role="status">The colour background is removed when you save.</p>
    {:else if folderChoice === 'behind' && keptPicture}
      <p class="toggle-hint radio-hint" id="bg-inherit-hint">This folder's own picture is kept for when you switch back.</p>
      <button type="button" class="remove-kept-btn" onclick={() => (backgroundType = 'none')}>Remove it</button>
    {/if}
  {:else}
    <div class="inherit-radios" role="radiogroup" aria-label="Tab background" aria-describedby={inheritOn ? 'bg-inherit-hint' : undefined}>
      <label class="inherit-radio">
        <input type="radio" name="bg-source" checked={inheritOn} onchange={() => (inheritOn = true)} />
        <span>Same as the dashboard</span>
      </label>
      <label class="inherit-radio">
        <input type="radio" name="bg-source" checked={!inheritOn} onchange={() => (inheritOn = false)} />
        <span>Its own background</span>
      </label>
    </div>
    {#if inheritOn}
      <p class="toggle-hint radio-hint" id="bg-inherit-hint">This {level}'s own picture is kept for when you switch back.</p>
    {/if}
  {/if}
</div>

{#if showPictureControls}
<!-- Background Type Selection -->
<div class="form-group">
  <!-- svelte-ignore a11y_label_has_associated_control -->
  <label id="bg-type-label">{isFolder ? 'Picture type' : 'Background Type'} {#if inheritOn}<span class="label-hint">(kept, not shown while inheriting)</span>{/if}</label>
  <div class="type-buttons" role="group" aria-labelledby="bg-type-label">
    {#if !isFolder}
      <button class="type-btn" class:active={backgroundType === 'none'} onclick={() => backgroundType = 'none'}>
        <Icon icon="mdi:close-circle-outline" width="24" />
        <span>None</span>
      </button>
      <button class="type-btn" class:active={backgroundType === 'color'} onclick={() => backgroundType = 'color'}>
        <Icon icon="mdi:palette" width="24" />
        <span>Color</span>
      </button>
    {/if}
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
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label id="image-fit-label">Image Fit</label>
    <div class="fit-buttons" role="group" aria-labelledby="image-fit-label">
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

<!-- One show-through opacity for this level's surface (call 2). -->
{#if backgroundType !== 'none'}
  <div class="form-group">
    <div class="slider-header">
      <label for="bg-opacity">Background opacity: {Math.round(Number(surfaceOpacity) * 100)}%</label>
      <button class="reset-link" onclick={() => surfaceOpacity = 1}>Reset</button>
    </div>
    <input id="bg-opacity" type="range" min="0" max="1" step="0.05" bind:value={surfaceOpacity} aria-describedby="bg-opacity-hint" />
    <div class="slider-labels">
      <span>See-through</span>
      <span>Solid</span>
    </div>
    <p class="slider-hint" id="bg-opacity-hint">Lower lets what is behind this {level} show through.</p>
  </div>
{/if}

<!-- Overlay Controls (not for folders: one overlay, at canvas level — call 1) -->
{#if hasOverlay && (backgroundType === 'image' || backgroundType === 'slideshow')}
  <div class="form-group">
    <div class="slider-header">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label>Overlay Darkness: {Math.round(overlayOpacity * 100)}%</label>
      <button class="reset-link" onclick={() => overlayOpacity = 0.7}>Reset</button>
    </div>
    <input type="range" min="0" max="1" step="0.05" bind:value={overlayOpacity} />
    <div class="slider-labels">
      <span>Clear</span>
      <span>Dark</span>
    </div>
  </div>

  <div class="form-group">
    <div class="slider-header">
      <!-- svelte-ignore a11y_label_has_associated_control -->
      <label>Overlay Blur: {overlayBlur}px</label>
      <button class="reset-link" onclick={() => overlayBlur = 10}>Reset</button>
    </div>
    <input type="range" min="0" max="20" step="1" bind:value={overlayBlur} />
    <div class="slider-labels">
      <span>None</span>
      <span>Heavy</span>
    </div>
  </div>
{/if}

<!-- Single Image URL -->
{#if backgroundType === 'image'}
  <div class="form-group">
    <label for="imageUrl">Image URL</label>
    <input
      id="imageUrl"
      type="text"
      bind:value={singleImageUrl}
      placeholder="https://example.com/image.jpg or /backgrounds/image.jpg"
      aria-invalid={singleUrlBad}
      aria-describedby={singleUrlBad ? 'imageUrl-error' : undefined}
    />
    {#if singleUrlBad}
      <p class="field-error" id="imageUrl-error" role="alert">{URL_RULE}</p>
    {/if}
  </div>

  {#if singleImageUrl && !singleUrlBad}
    <div class="preview">
      <img src={singleImageUrl} alt="Preview" />
    </div>
  {/if}
{/if}

<!-- Slideshow Configuration -->
{#if backgroundType === 'slideshow'}
  <div class="form-group">
    <label for="interval">Rotation Interval (seconds, {INTERVAL_MIN}–{INTERVAL_MAX})</label>
    <input
      id="interval"
      type="number"
      bind:value={slideshowInterval}
      min={INTERVAL_MIN}
      max={INTERVAL_MAX}
      step="5"
      onchange={() => (slideshowInterval = clampInterval(Number(slideshowInterval)))}
    />
    {#if intervalNormalised !== null}
      <p class="field-note" role="status">
        The stored interval ({intervalNormalised}) is outside {INTERVAL_MIN}–{INTERVAL_MAX} s; it is used as {clampInterval(background?.interval)} s and saved that way.
      </p>
    {/if}
  </div>

  <div class="form-group">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label id="transition-effect-label">Transition Effect</label>
    <div class="transition-buttons" role="group" aria-labelledby="transition-effect-label">
      <button class="transition-btn" class:active={transitionEffect === 'crossfade'} onclick={() => transitionEffect = 'crossfade'} title="Crossfade">
        <Icon icon="mdi:blur" width="20" />
        <span>Crossfade</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'slide'} onclick={() => transitionEffect = 'slide'} title="Slide Right">
        <Icon icon="mdi:arrow-right-bold" width="20" />
        <span>Slide</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'slide-up'} onclick={() => transitionEffect = 'slide-up'} title="Slide Up">
        <Icon icon="mdi:arrow-up-bold" width="20" />
        <span>Slide Up</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'slide-down'} onclick={() => transitionEffect = 'slide-down'} title="Slide Down">
        <Icon icon="mdi:arrow-down-bold" width="20" />
        <span>Slide Down</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'zoom'} onclick={() => transitionEffect = 'zoom'} title="Zoom In">
        <Icon icon="mdi:magnify-plus" width="20" />
        <span>Zoom In</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'zoom-out'} onclick={() => transitionEffect = 'zoom-out'} title="Zoom Out">
        <Icon icon="mdi:magnify-minus" width="20" />
        <span>Zoom Out</span>
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
      <button class="transition-btn" class:active={transitionEffect === 'swirl'} onclick={() => transitionEffect = 'swirl'} title="Swirl">
        <Icon icon="mdi:rotate-right" width="20" />
        <span>Swirl</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'wipe'} onclick={() => transitionEffect = 'wipe'} title="Wipe">
        <Icon icon="mdi:chevron-double-right" width="20" />
        <span>Wipe</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'curtain'} onclick={() => transitionEffect = 'curtain'} title="Curtain">
        <Icon icon="mdi:curtains" width="20" />
        <span>Curtain</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'circle'} onclick={() => transitionEffect = 'circle'} title="Circle Reveal">
        <Icon icon="mdi:circle-outline" width="20" />
        <span>Circle</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'diamond'} onclick={() => transitionEffect = 'diamond'} title="Diamond Reveal">
        <Icon icon="mdi:rhombus-outline" width="20" />
        <span>Diamond</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'dissolve'} onclick={() => transitionEffect = 'dissolve'} title="Dissolve">
        <Icon icon="mdi:grain" width="20" />
        <span>Dissolve</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'flash'} onclick={() => transitionEffect = 'flash'} title="Flash">
        <Icon icon="mdi:white-balance-sunny" width="20" />
        <span>Flash</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'glitch'} onclick={() => transitionEffect = 'glitch'} title="Glitch">
        <Icon icon="mdi:television-classic" width="20" />
        <span>Glitch</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'kenburns'} onclick={() => transitionEffect = 'kenburns'} title="Ken Burns">
        <Icon icon="mdi:movie" width="20" />
        <span>Ken Burns</span>
      </button>
      <button class="transition-btn" class:active={transitionEffect === 'none'} onclick={() => transitionEffect = 'none'} title="Instant">
        <Icon icon="mdi:flash-off" width="20" />
        <span>Instant</span>
      </button>
      <button class="transition-btn special" class:active={transitionEffect === 'random'} onclick={() => transitionEffect = 'random'} title="Random - picks a different transition each time">
        <Icon icon="mdi:shuffle-variant" width="20" />
        <span>Random</span>
      </button>
    </div>
  </div>

  <div class="form-group">
    <label for="transitionDuration">Transition Duration ({transitionDuration}s)</label>
    <input id="transitionDuration" type="range" bind:value={transitionDuration} min={DURATION_MIN} max={DURATION_MAX} step="0.5" class="range-input" disabled={transitionEffect === 'none'} />
    <div class="range-labels">
      <span>{DURATION_MIN}s</span>
      <span>{DURATION_MAX}s</span>
    </div>
    {#if durationNormalised !== null}
      <p class="field-note" role="status">
        The stored transition duration ({durationNormalised}) is outside {DURATION_MIN}–{DURATION_MAX} s; it is used as {clampDuration(background?.transitionDuration)} s and saved that way.
      </p>
    {/if}
  </div>

  <!-- Transition Preview - positioned right after effect selection -->
  {#if slideshowImages.length > 1}
    <div class="transition-preview">
      <label><Icon icon="mdi:eye" width="16" /> Transition Preview ({transitionEffect}{transitionEffect === 'random' ? ` → ${effectiveTransition}` : ''})</label>
      <div class="preview-container">
        <div
          class="preview-layer layer-1 transition-{effectiveTransition}"
          class:visible={previewLayer1Visible}
          class:kenburns-0={effectiveTransition === 'kenburns' && previewLayer1KenBurns === 0}
          class:kenburns-1={effectiveTransition === 'kenburns' && previewLayer1KenBurns === 1}
          class:kenburns-2={effectiveTransition === 'kenburns' && previewLayer1KenBurns === 2}
          class:kenburns-3={effectiveTransition === 'kenburns' && previewLayer1KenBurns === 3}
          style:background-image={previewLayer1Image ? cssUrl(previewLayer1Image) : 'none'}
          style:--transition-duration="{transitionDuration}s"
        ></div>
        <div
          class="preview-layer layer-2 transition-{effectiveTransition}"
          class:visible={!previewLayer1Visible}
          class:kenburns-0={effectiveTransition === 'kenburns' && previewLayer2KenBurns === 0}
          class:kenburns-1={effectiveTransition === 'kenburns' && previewLayer2KenBurns === 1}
          class:kenburns-2={effectiveTransition === 'kenburns' && previewLayer2KenBurns === 2}
          class:kenburns-3={effectiveTransition === 'kenburns' && previewLayer2KenBurns === 3}
          style:background-image={previewLayer2Image ? cssUrl(previewLayer2Image) : 'none'}
          style:--transition-duration="{transitionDuration}s"
        ></div>
        <!-- Curtain overlay: shows the previous image splitting apart -->
        {#if effectiveTransition === 'curtain' && curtainAnimating}
          <div
            class="curtain-overlay"
            style:--transition-duration="{transitionDuration}s"
          >
            <div
              class="curtain-half curtain-left"
              style:background-image={curtainPreviousImage ? cssUrl(curtainPreviousImage) : 'none'}
            ></div>
            <div
              class="curtain-half curtain-right"
              style:background-image={curtainPreviousImage ? cssUrl(curtainPreviousImage) : 'none'}
            ></div>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <div class="form-group">
    <!-- svelte-ignore a11y_label_has_associated_control -->
    <label id="selected-images-label">Selected Images ({slideshowImages.length})</label>
    {#if slideshowImages.length > 0}
      <div class="selected-images" aria-labelledby="selected-images-label">
        {#each slideshowImages as imageUrl, index}
          <div class="selected-image" class:unsafe={!isSafeBackgroundUrl(imageUrl)}>
            {#if isSafeBackgroundUrl(imageUrl)}
              <img src={imageUrl} alt="Slide {index + 1}" />
            {:else}
              <span class="unsafe-note" title={imageUrl}>Can't be used</span>
            {/if}
            <button class="remove-btn" onclick={() => handleRemoveFromSlideshow(index)} title="Remove">
              <Icon icon="mdi:close" width="16" />
            </button>
            <span class="image-index">{index + 1}</span>
          </div>
        {/each}
      </div>
    {:else}
      <p class="empty-message">No images selected. Choose from the gallery below or upload your own.</p>
    {/if}
    {#if unsafeImages.length > 0}
      <p class="field-error" role="alert">
        {unsafeImages.length === 1 ? 'This saved image' : `${unsafeImages.length} saved images`} can't be used as a background
        (not http(s), /backgrounds/… or /presets/…): {unsafeImages.slice(0, 3).join(', ')}{unsafeImages.length > 3 ? ', …' : ''}. Remove {unsafeImages.length === 1 ? 'it' : 'them'} to save.
      </p>
    {/if}
  </div>

  <!-- Custom URL Input -->
  <div class="form-group">
    <label for="custom-image-url">Add Custom Image URL</label>
    <div class="url-input-group">
      <input
        id="custom-image-url"
        type="text"
        bind:value={customImageUrl}
        placeholder="https://example.com/image.jpg"
        aria-invalid={customUrlError !== ''}
        aria-describedby={customUrlError ? 'custom-image-url-error' : undefined}
        oninput={() => (customUrlError = '')}
        onkeydown={(e) => e.key === 'Enter' && handleAddCustomUrl()}
      />
      <button onclick={handleAddCustomUrl} class="add-btn">
        <Icon icon="mdi:plus" width="20" />
        Add
      </button>
    </div>
    {#if customUrlError}
      <p class="field-error" id="custom-image-url-error" role="alert">{customUrlError}</p>
    {/if}
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
    {#if loadError}
      <p class="upload-error" role="alert">{loadError}</p>
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
              <span
                class="delete-btn"
                role="button"
                tabindex="0"
                onclick={(e) => { e.stopPropagation(); handleDeleteImage(image); }}
                onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); handleDeleteImage(image); } }}
                title="Delete"
              >
                <Icon icon="mdi:trash-can" width="16" />
              </span>
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

<!-- Hover preview -->
{/if}

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







  .form-group {
    margin-bottom: 1.5rem;
  }

  .selected-image.unsafe {
    outline: 2px solid var(--color-error, #dc2626);
  }
  .unsafe-note {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    font-size: 0.7rem;
    color: var(--color-error, #dc2626);
    text-align: center;
  }

  .field-note {
    margin: 0.35rem 0 0;
    font-size: 0.8rem;
    color: var(--color-warning);
  }

  .field-error {
    margin: 0.4rem 0 0;
    color: var(--color-error, #dc2626);
    font-size: 0.85rem;
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

  /* Keyboard focus on the (visually hidden) switch shows on the drawn switch. */
  .toggle-checkbox:focus-visible ~ .toggle-text,
  .toggle-label:has(.toggle-checkbox:focus-visible) .toggle-switch {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .slider-hint {
    margin: 0.4rem 0 0;
    font-size: 0.8rem;
    color: var(--text-secondary);
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

  .inherit-radios {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .inherit-radio {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
    color: var(--text-primary, inherit);
  }
  .toggle-hint {
    margin: 0.75rem 0 0 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    padding-left: calc(48px + 1rem);
  }

  .toggle-hint.radio-hint {
    padding-left: 0;
  }

  .legacy-colour {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 0.75rem;
    margin-top: 0.75rem;
  }
  .legacy-swatch {
    width: 1.5rem;
    height: 1.5rem;
    border-radius: 0.25rem;
    border: 1px solid var(--text-secondary);
    flex-shrink: 0;
  }
  .radio-hint-text {
    margin: 0;
    flex: 1 1 16rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }
  .use-colour-btn,
  .remove-kept-btn {
    background: var(--bg-tertiary);
    border: 1px solid var(--border);
    color: var(--text-primary);
    border-radius: 0.375rem;
    padding: 0.4rem 0.8rem;
    font-size: 0.875rem;
    cursor: pointer;
  }
  .remove-kept-btn {
    margin-top: 0.5rem;
  }
  .use-colour-btn:hover,
  .remove-kept-btn:hover {
    border-color: var(--accent);
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
    background: var(--accent-solid);
    border-color: var(--accent-solid);
    color: var(--on-accent);
  }

  /* Special styling for Random transition button */
  .transition-btn.special {
    background: linear-gradient(135deg, var(--bg-tertiary) 0%, rgba(139, 92, 246, 0.1) 100%);
    border-style: dashed;
  }

  .transition-btn.special:hover {
    background: linear-gradient(135deg, var(--bg-primary) 0%, rgba(139, 92, 246, 0.2) 100%);
    border-color: var(--color-accent-violet);
    border-style: solid;
  }

  .transition-btn.special.active {
    background: linear-gradient(135deg, var(--color-accent-violet) 0%, var(--color-accent-indigo) 100%);
    border-color: var(--color-accent-violet);
    border-style: solid;
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
    background: var(--danger-solid);
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
    background: var(--accent-solid);
    color: var(--on-accent);
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .add-btn:hover {
    background: var(--accent-solid-hover);
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
    background: var(--accent-solid);
    color: var(--on-accent);
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
    transition: all 0.2s;
  }

  .upload-btn:hover {
    background: var(--accent-solid-hover);
  }

  .upload-error {
    color: var(--color-error-text);
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
    background: var(--accent-solid);
    border-color: var(--accent-solid);
    color: var(--on-accent);
  }

  .category-tab .count {
    opacity: 0.7;
    font-size: 0.75rem;
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
    background: var(--accent-solid);
    color: var(--on-accent);
    border: none;
    border-radius: 0.375rem;
    cursor: pointer;
    font-weight: 500;
    font-size: 0.875rem;
    transition: all 0.2s;
  }

  .create-category-btn:hover {
    background: var(--accent-solid-hover);
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
    border-color: var(--color-success-alt);
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
    background: var(--warning-solid);
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
    background: var(--danger-solid);
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
    background: var(--danger-solid-hover);
    transform: scale(1.15);
  }

  .selected-badge {
    position: absolute;
    bottom: 0.25rem;
    right: 0.25rem;
    background: var(--success-solid);
    color: white;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
  }


  /* .btn-primary, .btn-secondary and .spin styles are defined globally in app.css */

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

  .preview-layer.transition-slide-up {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: translateY(100%);
  }

  .preview-layer.transition-slide-up.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .preview-layer.transition-slide-down {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: translateY(-100%);
  }

  .preview-layer.transition-slide-down.visible {
    opacity: 1;
    transform: translateY(0);
  }

  .preview-layer.transition-zoom {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: scale(1.2);
  }

  .preview-layer.transition-zoom.visible {
    opacity: 1;
    transform: scale(1);
  }

  .preview-layer.transition-zoom-out {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: scale(0.8);
  }

  .preview-layer.transition-zoom-out.visible {
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

  .preview-layer.transition-swirl {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, transform var(--transition-duration, 1.5s) ease-in-out;
    transform: rotate(180deg) scale(0);
  }

  .preview-layer.transition-swirl.visible {
    opacity: 1;
    transform: rotate(0deg) scale(1);
  }

  .preview-layer.transition-wipe {
    opacity: 1;
    clip-path: inset(0 100% 0 0);
    transition: clip-path var(--transition-duration, 1.5s) ease-in-out;
  }

  .preview-layer.transition-wipe.visible {
    opacity: 1;
    clip-path: inset(0 0 0 0);
  }

  /* Curtain: The actual transition is handled by the curtain overlay */
  /* Both layers just show fully - the overlay does the split animation */
  .preview-layer.transition-curtain {
    opacity: 1;
    transition: none;
  }

  .preview-layer.transition-curtain.visible {
    z-index: 2 !important;
  }

  .preview-layer.transition-curtain:not(.visible) {
    z-index: 1 !important;
  }

  /* Curtain overlay - two halves that slide apart */
  .curtain-overlay {
    position: absolute;
    inset: 0;
    z-index: 100;
    overflow: hidden;
    pointer-events: none;
  }

  .curtain-half {
    position: absolute;
    top: 0;
    height: 100%;
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
  }

  .curtain-left {
    left: 0;
    width: 100%;
    clip-path: inset(0 50% 0 0);
    animation: curtainSlideLeft var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  .curtain-right {
    left: 0;
    width: 100%;
    clip-path: inset(0 0 0 50%);
    animation: curtainSlideRight var(--transition-duration, 1.5s) ease-in-out forwards;
  }

  @keyframes curtainSlideLeft {
    0% { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }

  @keyframes curtainSlideRight {
    0% { transform: translateX(0); }
    100% { transform: translateX(50%); }
  }

  .preview-layer.transition-circle {
    opacity: 1;
    clip-path: circle(0% at 50% 50%);
    transition: clip-path var(--transition-duration, 1.5s) ease-in-out;
  }

  .preview-layer.transition-circle.visible {
    clip-path: circle(150% at 50% 50%);
  }

  .preview-layer.transition-diamond {
    opacity: 1;
    clip-path: polygon(50% 50%, 50% 50%, 50% 50%, 50% 50%);
    transition: clip-path var(--transition-duration, 1.5s) ease-in-out;
  }

  .preview-layer.transition-diamond.visible {
    /* Extend far beyond viewport to ensure full coverage on any aspect ratio */
    clip-path: polygon(50% -100%, 200% 50%, 50% 200%, -100% 50%);
  }

  .preview-layer.transition-dissolve {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out, filter var(--transition-duration, 1.5s) ease-in-out;
    filter: grayscale(100%) contrast(200%);
  }

  .preview-layer.transition-dissolve.visible {
    opacity: 1;
    filter: grayscale(0%) contrast(100%);
  }

  .preview-layer.transition-flash {
    transition: opacity calc(var(--transition-duration, 1.5s) / 2) ease-in-out;
  }

  .preview-layer.transition-flash.visible {
    opacity: 1;
    animation: flashPreview var(--transition-duration, 1.5s) ease-in-out;
  }

  @keyframes flashPreview {
    0% { opacity: 0; filter: brightness(1); }
    30% { opacity: 1; filter: brightness(3); }
    100% { opacity: 1; filter: brightness(1); }
  }

  .preview-layer.transition-glitch {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out;
  }

  .preview-layer.transition-glitch.visible {
    opacity: 1;
    animation: glitchPreview var(--transition-duration, 1.5s) ease-in-out;
  }

  @keyframes glitchPreview {
    0% { opacity: 0; transform: translate(0); filter: hue-rotate(0deg); }
    20% { opacity: 0.5; transform: translate(-5px, 3px); filter: hue-rotate(90deg); }
    40% { opacity: 0.7; transform: translate(5px, -3px); filter: hue-rotate(180deg); }
    60% { opacity: 0.9; transform: translate(-3px, 5px); filter: hue-rotate(270deg); }
    80% { opacity: 1; transform: translate(3px, -5px); filter: hue-rotate(360deg); }
    100% { opacity: 1; transform: translate(0); filter: hue-rotate(0deg); }
  }

  .preview-layer.transition-random {
    transition: opacity var(--transition-duration, 1.5s) ease-in-out;
  }

  .preview-layer.transition-random.visible {
    opacity: 1;
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
    z-index: var(--z-modal-critical);
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

  .slider-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .slider-header label {
    font-weight: 500;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .reset-link {
    background: none;
    border: none;
    color: var(--accent);
    cursor: pointer;
    font-size: 0.8rem;
    padding: 0;
  }

  .reset-link:hover {
    text-decoration: underline;
  }

  input[type="range"] {
    width: 100%;
    height: 8px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--bg-tertiary);
    border-radius: 4px;
    outline: none;
  }

  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .slider-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-top: 0.25rem;
  }
</style>
