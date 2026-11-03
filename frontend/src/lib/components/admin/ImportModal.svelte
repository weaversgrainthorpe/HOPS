<script lang="ts">
  import Icon from '@iconify/svelte';
  import Modal from '$lib/components/shared/Modal.svelte';
  import { importConfig, previewImport } from '$lib/utils/api';
  import {
    importProblems, initialChoices, choicesReady, allSkipped, summaryLines,
    type ImportChoice, type ImportPreview
  } from '$lib/utils/importResult';
  import { toast } from '$lib/stores/toast';

  interface Props {
    onClose: () => void;
    onImportSuccess?: () => void;
  }

  let { onClose, onImportSuccess }: Props = $props();
  // Two steps: the file is checked first (nothing is written) and its dashboards
  // listed, each clash with a choice; only then is anything imported.
  let checking = $state(false);
  let importing = $state(false);
  let error = $state<string | null>(null);
  let preview = $state<ImportPreview | null>(null);
  let choices = $state<(ImportChoice | null)[]>([]);
  // What the import did, shown until the dialog is closed.
  let done = $state<{ message: string; lines: string[] } | null>(null);
  // Set when the import was saved but part of it failed: shown as a warning
  // that stays until the user closes the dialog.
  let partial = $state<{ message: string; lines: string[]; problems: string[] } | null>(null);
  let fileInput = $state<HTMLInputElement>();
  let selectedFile = $state<File | null>(null);
  let autoMatchIcons = $state(true);

  const ready = $derived(preview ? choicesReady(preview.dashboards, choices) : false);
  const nothing = $derived(allSkipped(choices));
  const clashes = $derived(preview ? preview.dashboards.filter((d) => d.clash).length : 0);

  function handleFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    selectedFile = target.files?.[0] || null;
    preview = null;
    choices = [];
    error = null;
  }

  async function handleCheck() {
    if (!selectedFile) {
      error = 'Please select a file to import';
      return;
    }
    checking = true;
    error = null;
    try {
      const p = await previewImport(selectedFile);
      preview = p;
      choices = initialChoices(p.dashboards);
    } catch (err) {
      error = err instanceof Error ? err.message : 'The file could not be checked';
      toast.error('Import failed');
    } finally {
      checking = false;
    }
  }

  async function handleImport() {
    if (!selectedFile || !preview || !ready) return;
    importing = true;
    error = null;
    partial = null;
    try {
      const result = await importConfig(selectedFile, {
        autoMatchIcons,
        choices: choices as ImportChoice[],
        targets: preview.dashboards.map((d) => d.clash?.id ?? '')
      });
      const lines = result.summary ? summaryLines(result.summary) : [];
      const message = result.message || 'Import finished.';
      const problems = importProblems(result);
      if (problems.length > 0) {
        // Saved, but not completely: never a plain green box.
        partial = { message, lines, problems };
        toast.warning('Imported with problems \u2014 see the import dialog');
      } else {
        done = { message, lines };
        toast.success('Import finished');
      }
      preview = null;
      onImportSuccess?.(); // show what was saved
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to import configuration';
      toast.error('Import failed');
    } finally {
      importing = false;
    }
  }

  function back() {
    preview = null;
    choices = [];
    error = null;
  }

  function selectFile() {
    fileInput?.click();
  }
</script>

<Modal
  id="import-config"
  title="Import Dashboards"
  titleIcon="mdi:tray-arrow-down"
  onClose={onClose}
  maxWidth="600px"
>
  {#if error}
    <div class="alert alert-error" role="alert" data-testid="import-error">
      <Icon icon="mdi:alert-circle" width="24" />
      <span>{error}</span>
    </div>
  {/if}

  {#if done}
    <div class="alert alert-success" data-testid="import-success">
      <Icon icon="mdi:check-circle" width="24" />
      <div>
        <p class="alert-title">{done.message}</p>
        {#if done.lines.length}
          <ul data-testid="import-summary">
            {#each done.lines as line, i (i)}
              <li>{line}</li>
            {/each}
          </ul>
        {/if}
      </div>
    </div>
  {/if}

  {#if partial}
    <div class="alert alert-warning" role="alert" data-testid="import-warning">
      <Icon icon="mdi:alert" width="24" />
      <div>
        <p class="alert-title">Imported, but not everything succeeded</p>
        <p>{partial.message}</p>
        {#if partial.lines.length}
          <ul data-testid="import-summary">
            {#each partial.lines as line, i (i)}
              <li>{line}</li>
            {/each}
          </ul>
        {/if}
        <p>Check these:</p>
        <ul>
          {#each partial.problems as problem, i (i)}
            <li>{problem}</li>
          {/each}
        </ul>
      </div>
    </div>
  {/if}

  {#if preview}
    <p class="description">
      {preview.dashboards.length} {preview.dashboards.length === 1 ? 'dashboard' : 'dashboards'} in this file ({preview.format}).
      {#if clashes > 0}
        {clashes === 1 ? 'One has' : `${clashes} have`} the same name as a dashboard you already have. Choose what to do with {clashes === 1 ? 'it' : 'each'}.
      {/if}
      Choose Skip for any you don't want. Nothing changes until you click Import.
    </p>
    <ul class="import-rows" data-testid="import-rows">
      {#each preview.dashboards as row, i (row.index)}
        <li class="import-row" data-testid="import-row" data-name={row.name}>
          <div class="row-head">
            <span class="row-name">{row.name}</span>
            <span class="row-meta">{row.path} · {row.tabs} {row.tabs === 1 ? 'tab' : 'tabs'}</span>
          </div>
          {#if row.clash}
            <fieldset class="row-choice">
              <legend>You already have a dashboard called "{row.clash.name}" ({row.clash.path}).</legend>
              <label>
                <input type="radio" name="choice-{i}" value="replace" bind:group={choices[i]} />
                Replace <span class="hint">yours with the one in the file</span>
              </label>
              <label>
                <input type="radio" name="choice-{i}" value="keep" bind:group={choices[i]} />
                Keep both <span class="hint">the new one gets a number, like "{row.name} (2)"</span>
              </label>
              <label>
                <input type="radio" name="choice-{i}" value="skip" bind:group={choices[i]} />
                Skip <span class="hint">don't import this one</span>
              </label>
            </fieldset>
          {:else}
            <fieldset class="row-choice">
              <legend>New here: no dashboard has this name.</legend>
              <label>
                <input type="radio" name="choice-{i}" value="add" bind:group={choices[i]} />
                Add <span class="hint">import this one</span>
              </label>
              <label>
                <input type="radio" name="choice-{i}" value="skip" bind:group={choices[i]} />
                Skip <span class="hint">don't import this one</span>
              </label>
            </fieldset>
          {/if}
        </li>
      {/each}
    </ul>
    {#if nothing}
      <p class="nothing-note" role="status" data-testid="import-nothing">Nothing would be imported: every dashboard is set to Skip.</p>
    {/if}
    {#if preview.notCarried?.length}
      <p class="description">Some things in this file can't be brought across. They are listed after the import.</p>
    {/if}
  {:else if !done && !partial}
    <p class="description">Choose a file. HOPS checks it and lists its dashboards before anything is imported.</p>

    <div class="file-input-container">
      <input
        type="file"
        accept=".json,.yml,.yaml"
        bind:this={fileInput}
        onchange={handleFileChange}
        style="display: none;"
        data-testid="import-file"
      />
      <button class="btn-secondary" onclick={selectFile}>
        <Icon icon="mdi:file-upload" width="20" />
        Select File
      </button>
      {#if selectedFile}
        <span class="file-name">{selectedFile.name}</span>
      {/if}
    </div>

    <div class="supported-formats">
      <p class="formats-title">Supported formats:</p>
      <ul>
        <li><strong>HOPS export</strong> - one dashboard, or Export all</li>
        <li><strong>Homer YAML</strong> - config.yml from Homer dashboard</li>
        <li><strong>Dashy YAML</strong> - conf.yml from Dashy dashboard</li>
        <li><strong>Heimdall JSON</strong> - Export from Heimdall dashboard</li>
      </ul>
    </div>

    <label class="checkbox-option">
      <input type="checkbox" bind:checked={autoMatchIcons} />
      <span class="checkbox-label">
        <Icon icon="mdi:auto-fix" width="18" />
        Auto-match icons
      </span>
      <span class="checkbox-description">Search for matching icons based on tile names</span>
    </label>

    <div class="info-box">
      <Icon icon="mdi:information" width="20" />
      <div>
        <p><strong>Note:</strong> Imported dashboards are added next to yours. If one has the same name as a dashboard you have, you choose: replace it, keep both, or skip it. A backup is not imported here: restore it in Settings › Backups.</p>
      </div>
    </div>
  {/if}

  {#snippet footer()}
    <div class="modal-actions">
      {#if preview}
        <button type="button" class="btn-secondary" onclick={back} disabled={importing}>Back</button>
      {/if}
      <button type="button" class="btn-secondary" onclick={onClose}>
        {done || partial ? 'Close' : 'Cancel'}
      </button>
      {#if preview}
        <button class="btn-primary" onclick={handleImport} disabled={importing || !ready} data-testid="import-confirm">
          {#if importing}
            <Icon icon="mdi:loading" width="20" class="spin" />
            Importing...
          {:else}
            <Icon icon="mdi:upload" width="20" />
            Import
          {/if}
        </button>
      {:else if !done && !partial}
        <button class="btn-primary" onclick={handleCheck} disabled={checking || !selectedFile} data-testid="import-check">
          {#if checking}
            <Icon icon="mdi:loading" width="20" class="spin" />
            Checking...
          {:else}
            <Icon icon="mdi:arrow-right" width="20" />
            Next
          {/if}
        </button>
      {/if}
    </div>
  {/snippet}
</Modal>

<style>
  .description {
    margin: 0 0 1rem 0;
    font-size: 0.875rem;
    color: var(--text-secondary);
    line-height: 1.5;
  }

  .file-input-container {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .file-name {
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    width: 100%;
  }

  /* .btn-primary, .btn-secondary styles are defined globally in app.css */

  .alert {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    border-radius: 0.5rem;
    margin-bottom: 1rem;
  }

  .alert-error {
    background: color-mix(in srgb, var(--color-error-dark) 10%, transparent);
    color: var(--color-error-dark);
    border: 1px solid color-mix(in srgb, var(--color-error-dark) 20%, transparent);
  }

  .alert-warning {
    align-items: flex-start;
    background: color-mix(in srgb, var(--color-warning) 12%, transparent);
    color: var(--text-primary);
    border: 1px solid var(--color-warning);
  }

  .alert-warning :global(svg) {
    color: var(--color-warning);
    flex-shrink: 0;
  }

  .alert-warning p {
    margin: 0 0 0.25rem;
  }

  .alert-warning .alert-title {
    font-weight: 600;
  }

  .alert-warning ul {
    margin: 0.25rem 0 0;
    padding-left: 1.25rem;
    word-break: break-word;
  }

  .alert-success {
    align-items: flex-start;
    background: color-mix(in srgb, var(--color-success) 10%, transparent);
    color: var(--color-success);
    border: 1px solid color-mix(in srgb, var(--color-success) 20%, transparent);
  }

  .alert-success p,
  .alert-success ul {
    margin: 0 0 0.25rem;
  }

  .alert-success ul {
    padding-left: 1.25rem;
    color: var(--text-primary);
  }

  .import-rows {
    list-style: none;
    margin: 0 0 1rem;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .import-row {
    padding: 0.75rem 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .row-head {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .row-name {
    font-weight: 600;
    color: var(--text-primary);
  }

  .row-meta,
  .hint {
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  .nothing-note {
    margin: 0 0 1rem;
    font-size: 0.875rem;
    color: var(--text-secondary);
  }

  .row-choice {
    flex-basis: 100%;
    margin: 0;
    padding: 0;
    border: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .row-choice legend {
    padding: 0;
    margin-bottom: 0.25rem;
    font-size: 0.875rem;
    color: var(--text-primary);
  }

  .row-choice label {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.375rem;
    min-height: 2rem;
    font-size: 0.875rem;
    color: var(--text-primary);
    cursor: pointer;
  }

  .row-choice input[type="radio"] {
    accent-color: var(--accent);
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

  .supported-formats {
    margin: 0 0 1rem 0;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
  }

  .formats-title {
    margin: 0 0 0.5rem 0;
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .supported-formats ul {
    margin: 0;
    padding-left: 1.5rem;
    list-style: disc;
  }

  .supported-formats li {
    font-size: 0.875rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }

  .supported-formats li:last-child {
    margin-bottom: 0;
  }

  .checkbox-option {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    padding: 1rem;
    background: var(--bg-secondary);
    border: 1px solid var(--border);
    border-radius: 0.5rem;
    margin-bottom: 1rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .checkbox-option:hover {
    border-color: var(--accent);
  }

  .checkbox-option input[type="checkbox"] {
    width: 1.125rem;
    height: 1.125rem;
    accent-color: var(--accent);
    cursor: pointer;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    font-weight: 500;
    color: var(--text-primary);
  }

  .checkbox-description {
    width: 100%;
    margin-left: 1.625rem;
    font-size: 0.8125rem;
    color: var(--text-secondary);
  }

  :global(.spin) {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from {
      transform: rotate(0deg);
    }
    to {
      transform: rotate(360deg);
    }
  }
</style>
