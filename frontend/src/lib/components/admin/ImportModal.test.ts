import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/svelte';

vi.mock('$lib/utils/api', () => ({ importConfig: vi.fn(), previewImport: vi.fn() }));
vi.mock('$lib/stores/toast', () => ({
  toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }
}));

import * as api from '$lib/utils/api';
import { toast } from '$lib/stores/toast';
import ImportModal from './ImportModal.svelte';

function pickFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File(['{}'], 'conf.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file] });
  return fireEvent.change(input);
}

const preview = {
  preview: true as const,
  format: 'HOPS v3 export',
  dashboards: [
    { index: 0, name: 'Home', path: '/home', tabs: 2, clash: { id: 'd1', name: 'Home', path: '/home' } },
    { index: 1, name: 'Garage', path: '/garage', tabs: 1, clash: null }
  ]
};

async function toChoices() {
  vi.mocked(api.previewImport).mockResolvedValue(preview);
  await pickFile();
  await fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));
  await screen.findByTestId('import-rows');
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('ImportModal', () => {
  it('lists the dashboards, and imports only once every clash has a choice', async () => {
    vi.mocked(api.importConfig).mockResolvedValue({
      success: true,
      message: 'Imported from HOPS v3 export format.',
      assetsFailed: [],
      summary: { added: ['Garage'], replaced: [], renamed: [{ from: 'Home', to: 'Home (2)' }], skipped: [] }
    });
    const onClose = vi.fn();
    const onImportSuccess = vi.fn();
    render(ImportModal, { props: { onClose, onImportSuccess } });
    await toChoices();

    expect(api.importConfig).not.toHaveBeenCalled(); // checking writes nothing
    const rows = screen.getAllByTestId('import-row');
    expect(rows[0]).toHaveTextContent('You already have a dashboard called "Home"');
    expect(rows[1]).toHaveTextContent('Add');
    const go = screen.getByRole('button', { name: /^Import$/ });
    expect(go).toBeDisabled();

    await fireEvent.click(screen.getByRole('radio', { name: /Keep both/ }));
    expect(go).toBeEnabled();
    await fireEvent.click(go);

    const box = await screen.findByTestId('import-success');
    expect(box).toHaveTextContent('Added: Garage');
    expect(box).toHaveTextContent('Kept both: Home, the new one is "Home (2)"');
    expect(vi.mocked(api.importConfig).mock.calls[0][1]).toMatchObject({ choices: ['keep', 'add'], targets: ['d1', ''] });
    expect(onImportSuccess).toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 1700));
    expect(onClose).not.toHaveBeenCalled(); // the summary stays until closed
  });

  it('a partial failure shows a warning with the summary, never a plain success', async () => {
    vi.mocked(api.importConfig).mockResolvedValue({
      success: true,
      message: 'Imported from HOPS v3 export format.',
      assetsFailed: ['/icons/a.png: bad base64'],
      warning: 'Pre-update backup failed: disk full. Config saved anyway.',
      summary: { added: ['Garage'], replaced: ['Home'], renamed: [], skipped: [] }
    });
    render(ImportModal, { props: { onClose: vi.fn(), onImportSuccess: vi.fn() } });
    await toChoices();
    await fireEvent.click(screen.getByRole('radio', { name: /Replace/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));

    const box = await screen.findByTestId('import-warning');
    expect(box).toHaveTextContent('Replaced: Home');
    expect(box).toHaveTextContent('a.png');
    expect(box).toHaveTextContent('Pre-update backup failed');
    expect(screen.queryByTestId('import-success')).not.toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('fields HOPS does not recognise are named before and after the import, never a plain success', async () => {
    const note = "1 field HOPS doesn't recognise will be kept but not used: tab \"Main\" › mood";
    vi.mocked(api.previewImport).mockResolvedValue({
      ...preview,
      dashboards: [preview.dashboards[0], { ...preview.dashboards[1], unknownFields: note }]
    });
    const line = "Dashboard \"Garage\": 1 field HOPS doesn't recognise was kept but is not used: tab \"Main\" › mood";
    vi.mocked(api.importConfig).mockResolvedValue({
      success: true,
      message: "Imported from HOPS v3 export format. Added \"Garage\"; skipped \"Home\". 1 dashboard(s) have fields HOPS doesn't recognise (listed separately)",
      assetsFailed: [],
      unknownFields: [line],
      summary: { added: ['Garage'], replaced: [], renamed: [], skipped: ['Home'] }
    });
    render(ImportModal, { props: { onClose: vi.fn(), onImportSuccess: vi.fn() } });
    await pickFile();
    await fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));
    await screen.findByTestId('import-rows');
    const rows = screen.getAllByTestId('import-row');
    expect(within(rows[1]).getByTestId('import-row-unknown')).toHaveTextContent(note);
    expect(within(rows[0]).queryByTestId('import-row-unknown')).not.toBeInTheDocument();

    await fireEvent.click(within(rows[0]).getByRole('radio', { name: /^Skip/ }));
    await fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));
    const box = await screen.findByTestId('import-warning');
    expect(box).toHaveTextContent(line);
    expect(screen.queryByTestId('import-success')).not.toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalled();
  });

  it('a refused file says why, and nothing is imported', async () => {
    vi.mocked(api.previewImport).mockRejectedValue(
      new Error('Import refused — This file is a HOPS backup (the whole app), not a dashboard export.')
    );
    render(ImportModal, { props: { onClose: vi.fn() } });
    await pickFile();
    await fireEvent.click(screen.getByRole('button', { name: /^Next$/ }));
    expect(await screen.findByTestId('import-error')).toHaveTextContent('HOPS backup');
    expect(api.importConfig).not.toHaveBeenCalled();
  });

  it('a new dashboard can be skipped too, and skipping all of them imports nothing', async () => {
    vi.mocked(api.importConfig).mockResolvedValue({ success: true, message: 'ok', assetsFailed: [] });
    render(ImportModal, { props: { onClose: vi.fn() } });
    await toChoices();
    const garage = screen.getAllByTestId('import-row')[1];
    const add = within(garage).getByRole('radio', { name: /^Add/ });
    expect(add).toBeChecked(); // Add is the default for a new name
    await fireEvent.click(within(garage).getByRole('radio', { name: /^Skip/ }));
    const go = screen.getByRole('button', { name: /^Import$/ });
    await fireEvent.click(within(screen.getAllByTestId('import-row')[0]).getByRole('radio', { name: /^Skip/ }));
    expect(go).toBeDisabled();
    expect(screen.getByTestId('import-nothing')).toHaveTextContent('Nothing would be imported');

    await fireEvent.click(within(screen.getAllByTestId('import-row')[0]).getByRole('radio', { name: /^Replace/ }));
    expect(go).toBeEnabled();
    expect(screen.queryByTestId('import-nothing')).not.toBeInTheDocument();
    await fireEvent.click(go);
    await screen.findByTestId('import-success');
    expect(vi.mocked(api.importConfig).mock.calls[0][1]).toMatchObject({ choices: ['replace', 'skip'], targets: ['d1', ''] });
  });
});
