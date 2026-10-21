import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Entry from './Entry.svelte';
import { editMode } from '$lib/stores/editMode';
import type { Entry as EntryType } from '$lib/types';

const entry: EntryType = {
  id: 'e1', name: 'Plain', url: 'http://x.test', icon: '', openMode: 'newtab', size: 'medium', order: 0
};

// The tile only renders: editing (selection, menus, dialogs) belongs to the
// v3 editor's containers, never to the tile itself.
describe('Entry', () => {
  beforeEach(() => editMode.set(true));
  afterEach(() => editMode.set(false));

  it('ignores edit mode: no edit controls, no context menu and no edit dialog on click', async () => {
    const { container } = render(Entry, { entry });
    await tick();
    expect(container.querySelector('.edit-mode')).toBeNull();
    expect(container.querySelector('.hover-controls, [aria-label^="Delete"], [aria-label^="Edit"]')).toBeNull();
    await fireEvent.contextMenu(screen.getByText('Plain'));
    await tick();
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
    await fireEvent.click(screen.getByText('Plain'));
    await tick();
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
  });

  it('in the editor it shows whether it is selected', async () => {
    const { container, rerender } = render(Entry, { entry, editorSelected: false });
    await tick();
    const btn = container.querySelector('button.entry') as HTMLElement;
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.classList.contains('selected')).toBe(false);
    await rerender({ entry, editorSelected: true });
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.classList.contains('selected')).toBe(true);
    expect(btn.getAttribute('aria-label')).toBe('Plain');
  });

  it('outside the editor it is a link tile named "Open …" with no pressed state', async () => {
    const { container } = render(Entry, { entry });
    await tick();
    const btn = container.querySelector('button.entry') as HTMLElement;
    expect(btn.getAttribute('aria-label')).toBe('Open Plain');
    expect(btn.hasAttribute('aria-pressed')).toBe(false);
  });

  // Walkthrough §2: opacity fades the tile's background only; text and icon have their own.
  describe('opacity', () => {
    const layer = (c: HTMLElement) => c.querySelector('button.entry > .entry-bg') as HTMLElement;
    const btnOf = (c: HTMLElement) => c.querySelector('button.entry') as HTMLElement;

    it('is never set on the tile itself; the background layer carries it (default 0.95)', async () => {
      const { container, rerender } = render(Entry, { entry });
      await tick();
      expect(btnOf(container).style.opacity).toBe('');
      expect(layer(container)).not.toBeNull();
      expect(layer(container).style.opacity).toBe('0.95');
      await rerender({ entry: { ...entry, opacity: 0.2, color: '#ff0000' } });
      expect(btnOf(container).style.opacity).toBe('');
      expect(btnOf(container).style.backgroundColor).toBe('');
      expect(layer(container).style.opacity).toBe('0.2');
      expect(layer(container).style.backgroundColor).toBe('rgb(255, 0, 0)');
    });

    it('text and icon follow their own fields (default 1); the tile itself is never faded', async () => {
      const e = { ...entry, description: 'Desc', opacity: 0.1, textOpacity: 0.4, iconOpacity: 0.6 } as EntryType;
      const { container } = render(Entry, { entry: e });
      await tick();
      expect((container.querySelector('.title') as HTMLElement).style.opacity).toBe('0.4');
      expect((container.querySelector('.subtitle') as HTMLElement).style.opacity).toBe('0.4');
      expect((container.querySelector('.icon') as HTMLElement).style.opacity).toBe('0.6');
      // The status badge sits directly in the tile, outside the faded parts.
      expect(btnOf(container).style.opacity).toBe('');
    });

    it('text and icon opacity 0 (and background 0) never fade the status badge', async () => {
      const e = { ...entry, description: 'Desc', opacity: 0, textOpacity: 0, iconOpacity: 0, statusCheck: { enabled: true } } as unknown as EntryType;
      const { container } = render(Entry, { entry: e });
      await tick();
      const badge = container.querySelector('.status-badge') as HTMLElement;
      expect(badge, 'the tile has a status badge').not.toBeNull();
      // Every element from the badge up to (and including) the tile button is unfaded.
      const btn = btnOf(container);
      for (let el: HTMLElement | null = badge; el; el = el.parentElement) {
        expect(el.style.opacity === '' || Number(el.style.opacity) === 1, `${el.className} is not faded`).toBe(true);
        if (el === btn) break;
      }
      expect(btn.contains(badge)).toBe(true);
    });

    it('defaults: text and icon are fully opaque', async () => {
      const { container } = render(Entry, { entry: { ...entry, description: 'Desc' } });
      await tick();
      expect((container.querySelector('.title') as HTMLElement).style.opacity).toBe('1');
      expect((container.querySelector('.icon') as HTMLElement).style.opacity).toBe('1');
    });

    it('note tiles fade their text with textOpacity', async () => {
      const { container } = render(Entry, { entry: { ...entry, type: 'note', description: 'Body', textOpacity: 0.3 } });
      await tick();
      expect((container.querySelector('.note-title') as HTMLElement).style.opacity).toBe('0.3');
      expect((container.querySelector('.note-body') as HTMLElement).style.opacity).toBe('0.3');
    });

    it('clamps all three to 0–1 (2 → 1, -1 → 0, junk → default)', async () => {
      const { container, rerender } = render(Entry, { entry: { ...entry, opacity: 2, textOpacity: 2, iconOpacity: -1 } });
      await tick();
      expect(layer(container).style.opacity).toBe('1');
      expect((container.querySelector('.title') as HTMLElement).style.opacity).toBe('1');
      expect((container.querySelector('.icon') as HTMLElement).style.opacity).toBe('0');
      await rerender({ entry: { ...entry, opacity: 'x', textOpacity: NaN, iconOpacity: Infinity } as unknown as EntryType });
      expect(layer(container).style.opacity).toBe('0.95');
      expect((container.querySelector('.title') as HTMLElement).style.opacity).toBe('1');
      expect((container.querySelector('.icon') as HTMLElement).style.opacity).toBe('1');
    });
  });
});

// Spec §8: the size class follows the tile, so a changed Size shows at once (no reload).
describe('Entry size class', () => {
  it('is reactive: medium, then small, then large, on the same rendered tile', async () => {
    const { container, rerender } = render(Entry, { entry, fit: 'fill' });
    await tick();
    const btn = () => container.querySelector('button.entry')!;
    expect(btn().classList.contains('medium')).toBe(true);
    await rerender({ entry: { ...entry, size: 'small' }, fit: 'fill' });
    expect(btn().classList.contains('small')).toBe(true);
    expect(btn().classList.contains('medium')).toBe(false);
    await rerender({ entry: { ...entry, size: 'large' }, fit: 'fill' });
    expect(btn().classList.contains('large')).toBe(true);
  });
});

// Spec §10: one arrangement at every size and fit — name, icon, description, kept together and
// centred — and the content scales with the tile. jsdom has no layout and component CSS is not
// injected, so the structure is checked on the DOM and the rules on the component's own source.
describe('Entry content layout (spec §10)', () => {
  const withDesc = { ...entry, description: 'Search Engine' } as EntryType;
  const parts = (c: HTMLElement) =>
    [...c.querySelector('button.entry')!.children]
      .map((el) => el.className.split(' ').find((k) => ['title', 'icon', 'subtitle'].includes(k)))
      .filter(Boolean);

  for (const fit of [undefined, 'fill', 'compact'] as const)
    for (const size of ['small', 'medium', 'large'] as const)
      it(`${size}, fit ${fit ?? 'none'}: name, then icon, then description`, async () => {
        const { container } = render(Entry, { entry: { ...withDesc, size }, fit });
        await tick();
        expect(parts(container)).toEqual(['title', 'icon', 'subtitle']);
      });

  it('a fitted tile is a size container (the tile scales its content); an unfitted one is not', async () => {
    const { container, rerender } = render(Entry, { entry: withDesc, fit: 'compact' });
    await tick();
    const box = () => container.querySelector('.entry-container') as HTMLElement;
    expect(box().classList.contains('sized')).toBe(true);
    await rerender({ entry: withDesc, fit: 'fill' });
    expect(box().classList.contains('sized')).toBe(true);
    await rerender({ entry: withDesc, fit: undefined });
    expect(box().classList.contains('sized')).toBe(false);
  });

  describe('the component styles', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/components/Entry.svelte'), 'utf8');
    const css = src.slice(src.indexOf('<style>'));
    const rule = (sel: string) => {
      const i = css.indexOf(`\n  ${sel} {`);
      return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
    };

    it('never spreads the content apart (no space-between) and never reorders it', () => {
      expect(css).not.toMatch(/space-between/);
      expect(css).not.toMatch(/\border\s*:/);
    });

    it('has no compact-only arrangement: compact and fill differ in nothing but the class', () => {
      expect(css).not.toMatch(/\.compact/);
    });

    it('the fitted tile is a size container; icon and text use cqmin-based clamp() values', () => {
      expect(rule('.entry-container.sized')).toMatch(/container:\s*tile\s*\/\s*size/);
      // The ratios are cqmin custom properties (the size class nudges them); the clamps use them.
      const scaled = (v: string) => new RegExp(`clamp\\([^;]*var\\(--${v}-r\\)`);
      for (const v of ['icon', 'name', 'desc']) expect(rule('.entry.fill')).toMatch(new RegExp(`--${v}-r:\\s*[\\d.]+cqmin`));
      expect(css).toMatch(/\.fill \.icon :global\(svg\)[^{]*\{[^}]*clamp\([^;]*var\(--icon-r\)/);
      expect(css.slice(css.indexOf('.entry.fill .title {'))).toMatch(scaled('name'));
      expect(css.slice(css.indexOf('.entry.fill .subtitle {'))).toMatch(scaled('desc'));
    });

    it('the description hides only when the tile is too short (a container height query)', () => {
      expect(css).toMatch(/@container tile \(max-height:[^)]*\)\s*\{[^}]*\.subtitle[^}]*\{[^}]*display:\s*none/);
    });

    it('the size class no longer sets a fixed icon px on a fitted tile', () => {
      expect(css).not.toMatch(/\.fill\.small \.icon/);
      expect(css).not.toMatch(/\.fill\.large \.icon/);
    });
  });
});
