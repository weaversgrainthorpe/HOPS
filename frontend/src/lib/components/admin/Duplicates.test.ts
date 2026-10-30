import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { config } from '$lib/stores/config';
import Duplicates from './Duplicates.svelte';
import type { Config } from '$lib/types';

// A big setup can have thousands of duplicate groups. Drawing them all at once froze the browser
// with no sign of work; the report says it is working, then shows a page of groups at a time.
const tile = (id: string, url: string) =>
  ({ id, kind: 'tile', type: 'link', name: id, url, icon: 'mdi:lan', openMode: 'newtab', size: 'medium', order: 0 });

function withGroups(n: number) {
  const children = [];
  for (let i = 0; i < n; i++) children.push(tile(`a${i}`, `https://h${i}.lan/`), tile(`b${i}`, `https://h${i}.lan`));
  config.set({
    schemaVersion: 3,
    dashboards: [{ id: 'd', name: 'Home', path: '/home', revision: 1, tabs: [{ id: 't', name: 'Main', root: { columns: 24, children } }] }]
  } as unknown as Config);
}

const groups = () => document.querySelectorAll('[data-dup-group]');

beforeEach(() => localStorage.clear());

describe('Duplicates report at scale', () => {
  it('says it is working before the search runs, then shows the result', async () => {
    withGroups(3);
    render(Duplicates);
    expect(screen.getByRole('status')).toHaveTextContent('Finding duplicates…');
    expect(await screen.findByText('3 groups across all dashboards')).toBeTruthy();
    expect(groups()).toHaveLength(3);
    expect(document.querySelector('[data-dup-more]')).toBeNull();
  });

  it('shows 50 groups at a time, says how many in all, and Show more adds the next page', async () => {
    withGroups(120);
    render(Duplicates);
    await screen.findByText(/Showing 50 of 120 groups/);
    expect(groups()).toHaveLength(50);
    await fireEvent.click(screen.getByRole('button', { name: 'Show 50 more' }));
    expect(groups()).toHaveLength(100);
    expect(screen.getByText(/Showing 100 of 120 groups/)).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Show 20 more' }));
    expect(groups()).toHaveLength(120);
    expect(document.querySelector('[data-dup-more]')).toBeNull();
  });
});
