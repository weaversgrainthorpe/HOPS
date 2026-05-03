<script lang="ts">
  import QRCode from 'qrcode';
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import Button from '$lib/components/shared/Button.svelte';
  import { toast } from '$lib/stores/toast';

  interface Props {
    /** The dashboard to generate a QR code for */
    dashboard: { id: string; name: string; path: string };
    onClose: () => void;
  }

  let { dashboard, onClose }: Props = $props();

  // Build the full URL the user's phone will visit. This intentionally uses
  // window.location.origin so it works for any deployment topology — local
  // IP, mDNS hostname, reverse proxy, port forward — without configuration.
  const fullUrl = $derived(
    typeof window !== 'undefined' ? window.location.origin + dashboard.path : dashboard.path
  );

  let qrSvg = $state('');
  let qrError = $state('');

  // Regenerate the QR code whenever the URL changes (rare, but handles the
  // case where this modal is reused for different dashboards via key prop).
  $effect(() => {
    QRCode.toString(fullUrl, {
      type: 'svg',
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M'
    })
      .then((svg) => {
        qrSvg = svg;
        qrError = '';
      })
      .catch((err: unknown) => {
        qrError = err instanceof Error ? err.message : 'Failed to generate QR code';
      });
  });

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast.success('URL copied to clipboard');
    } catch {
      toast.error('Failed to copy URL');
    }
  }

  function handleDownload() {
    if (!qrSvg) return;

    const blob = new Blob([qrSvg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qr-${slugify(dashboard.name)}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // Convert dashboard name to a safe filename
  function slugify(name: string): string {
    return (
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'dashboard'
    );
  }
</script>

<Modal
  id="qr-code"
  title="QR Code"
  titleIcon="mdi:qrcode"
  onClose={onClose}
  maxWidth="420px"
>
  <div class="qr-content">
    <h3 class="dashboard-name">{dashboard.name}</h3>

    {#if qrError}
      <div class="alert-error">
        <Icon icon="mdi:alert-circle" width="20" />
        Failed to generate QR code: {qrError}
      </div>
    {:else if qrSvg}
      <!-- The qrcode library produces sanitized SVG markup; safe to render -->
      <div class="qr-frame">
        {@html qrSvg}
      </div>
      <p class="qr-hint">Scan with a phone camera to open this dashboard.</p>
      <div class="url-row">
        <code class="url-text" title={fullUrl}>{fullUrl}</code>
        <button
          type="button"
          class="copy-btn"
          onclick={handleCopy}
          title="Copy URL"
          aria-label="Copy URL to clipboard"
        >
          <Icon icon="mdi:content-copy" width="18" />
        </button>
      </div>
    {:else}
      <div class="loading">
        <Icon icon="mdi:loading" width="32" class="spin" />
        <span>Generating QR code…</span>
      </div>
    {/if}
  </div>

  {#snippet footer()}
    <div class="modal-actions">
      <Button variant="secondary" icon="mdi:download" onclick={handleDownload} disabled={!qrSvg}>
        Download SVG
      </Button>
      <Button variant="primary" onclick={onClose}>Close</Button>
    </div>
  {/snippet}
</Modal>

<style>
  .qr-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
    padding: 0.5rem 0;
  }

  .dashboard-name {
    margin: 0;
    font-size: 1rem;
    font-weight: 500;
    color: var(--text-secondary);
  }

  .qr-frame {
    background: white;
    padding: 1rem;
    border-radius: 0.5rem;
    line-height: 0;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  }

  /* Make the SVG QR code fill its container — qrcode lib emits inline width/height */
  .qr-frame :global(svg) {
    display: block;
    width: 100%;
    height: auto;
    max-width: 320px;
  }

  .qr-hint {
    margin: 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    text-align: center;
  }

  .url-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    width: 100%;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    padding: 0.5rem 0.5rem 0.5rem 0.75rem;
  }

  .url-text {
    flex: 1;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 0.8125rem;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: transparent;
  }

  .copy-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    cursor: pointer;
    color: var(--text-secondary);
    padding: 0.375rem;
    border-radius: var(--radius-sm);
    transition: all var(--transition-normal);
  }

  .copy-btn:hover {
    background: var(--bg-secondary);
    color: var(--text-primary);
  }

  .loading {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
    padding: 2rem;
    color: var(--text-secondary);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    width: 100%;
  }

  /* Mobile: stack footer buttons */
  @media (max-width: 480px) {
    .modal-actions {
      flex-direction: column-reverse;
    }
    .modal-actions :global(.btn) {
      width: 100%;
    }
  }
</style>
