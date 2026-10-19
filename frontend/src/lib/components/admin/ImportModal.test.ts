import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';

vi.mock('$lib/utils/api', () => ({ importConfig: vi.fn() }));
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('ImportModal', () => {
  it('a partial failure shows a warning state, reloads, and stays open until closed (I6)', async () => {
    vi.mocked(api.importConfig).mockResolvedValue({
      success: true,
      message: 'Imported 1 dashboard(s)',
      assetsFailed: ['/icons/a.png: bad base64'],
      warning: 'Pre-update backup failed: disk full. Config saved anyway.'
    });
    const onClose = vi.fn();
    const onImportSuccess = vi.fn();
    render(ImportModal, { props: { onClose, onImportSuccess } });
    await pickFile();
    await fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));

    const box = await screen.findByTestId('import-warning');
    expect(box).toHaveTextContent('Imported 1 dashboard(s)');
    expect(box).toHaveTextContent('a.png');
    expect(box).toHaveTextContent('Pre-update backup failed');
    expect(screen.queryByTestId('import-success')).not.toBeInTheDocument();
    expect(toast.warning).toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    expect(onImportSuccess).toHaveBeenCalled(); // the saved part is shown

    await new Promise((r) => setTimeout(r, 1700)); // past the success auto-close delay
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a clean import shows success and closes itself', async () => {
    vi.mocked(api.importConfig).mockResolvedValue({ success: true, message: 'Imported 1 dashboard(s)', assetsFailed: [] });
    const onClose = vi.fn();
    render(ImportModal, { props: { onClose, onImportSuccess: () => {} } });
    await pickFile();
    await fireEvent.click(screen.getByRole('button', { name: /^Import$/ }));
    expect(await screen.findByTestId('import-success')).toHaveTextContent('Imported 1 dashboard(s)');
    expect(toast.success).toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled(), { timeout: 2500 });
  });
});
