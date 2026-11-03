import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SMALL_TWO_LINES_MIN_PX } from '$lib/layout/folderShapePaths';
import Entry from './Entry.svelte';
import { editMode } from '$lib/stores/editMode';
import type { Entry as EntryType } from '$lib/types';
import HoverCard from './shared/HoverCard.svelte';
import { resetHoverCard } from '$lib/utils/hoverCard';
import { awayMode } from '$lib/stores/awayMode';

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

  // Opacity fades the tile's background only; text and icon have their own.
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

// The size class follows the tile, so a changed Size shows at once (no reload).
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

// One arrangement at every size and fit — name, icon, description, kept together and
// centred — and the content scales with the tile. jsdom has no layout and component CSS is not
// injected, so the structure is checked on the DOM and the rules on the component's own source.
describe('Entry content layout', () => {
  const withDesc = { ...entry, description: 'Search Engine' } as EntryType;
  const parts = (c: HTMLElement) =>
    [...c.querySelector('button.entry .tc')!.children]
      .map((el) => el.className.split(' ').find((k) => ['title', 'tc-icon', 'tc-desc-slot'].includes(k)))
      .filter(Boolean);

  // ONE arrangement at every size and fit, on a phone too (fit none): name, icon, then the description.
  for (const fit of [undefined, 'fill', 'compact'] as const)
    for (const size of ['small', 'medium', 'large'] as const)
      it(`${size}, fit ${fit ?? 'none'}: name, then icon, then description`, async () => {
        const { container } = render(Entry, { entry: { ...withDesc, size }, fit });
        await tick();
        expect(parts(container)).toEqual(['title', 'tc-icon', 'tc-desc-slot']);
        expect(container.querySelector('.tc')!.classList.contains(size)).toBe(true);
      });

  it('no description: no description slot (the icon keeps its place either way)', async () => {
    const { container } = render(Entry, { entry, fit: 'fill' });
    await tick();
    expect(parts(container)).toEqual(['title', 'tc-icon']);
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

  it('a long single word gets its width in em, so its font can shrink to fit before it breaks', async () => {
    const { container } = render(Entry, { entry: { ...entry, name: 'HomeAssistant', size: 'small' }, fit: 'compact' });
    await tick();
    const em = Number((container.querySelector('.tc-box') as HTMLElement).style.getPropertyValue('--name-word-em'));
    expect(em).toBeGreaterThan(5);
  });

  describe('the content rule (TileContent styles)', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/lib/components/layout/TileContent.svelte'), 'utf8');
    const css = src.slice(src.indexOf('<style>'));
    const rule = (sel: string) => {
      const i = css.indexOf(`\n  ${sel} {`);
      return i < 0 ? '' : css.slice(i, css.indexOf('\n  }', i));
    };
    const entryCss = (() => {
      const s = readFileSync(resolve(process.cwd(), 'src/lib/components/Entry.svelte'), 'utf8');
      return s.slice(s.indexOf('<style>'));
    })();

    it('never spreads the content apart and never reorders it; the name stays at the top', () => {
      expect(css).not.toMatch(/space-between/);
      expect(css).not.toMatch(/\border\s*:/);
      expect(rule('.tc')).toMatch(/justify-content:\s*flex-start/);
      expect(entryCss).not.toMatch(/\.compact/);
    });

    it('the box is a size container, and nothing in it scales by a dashboard setting', () => {
      expect(rule('.tc-box')).toMatch(/container:\s*tc\s*\/\s*size/);
      expect(css).not.toMatch(/content-scale|var\(--s\)/);
    });

    it('one description line is reserved for every tile of a size; the icon takes the rest, capped by the width', () => {
      expect(rule('.tc')).toMatch(/--desc-reserve:\s*calc\(var\(--desc-font\) \* 1\.2 \+ var\(--gap\)\)/);
      expect(rule('.tc')).toMatch(/--icon:\s*max\(12px,\s*min\(var\(--inner-w\),\s*calc\(var\(--inner-h\) - var\(--name-line\) - var\(--gap\) - var\(--desc-reserve\)\)\)\)/);
      // None reserved on a tile too short for a line at its floor (a Small grid tile).
      expect(css).toMatch(/@container tc \(max-height:\s*89\.99px\)\s*\{[^}]*\.tc\s*\{[^}]*--desc-reserve:\s*0px/);
    });

    it('padding 8cqmin and gaps 2.5cqmin, with px floors', () => {
      expect(rule('.tc')).toMatch(/--pad:\s*max\(3px,\s*8cqmin\)/);
      expect(rule('.tc')).toMatch(/--gap:\s*max\(2px,\s*2\.5cqmin\)/);
    });

    it('the description takes only the room left under the icon (basis 0), and hides when no line fits', () => {
      expect(rule('.tc-desc-slot')).toMatch(/flex:\s*1 1 0/);
      expect(rule('.tc-desc-slot')).toMatch(/container:\s*tcdesc\s*\/\s*size/);
      expect(css).toMatch(/@container tcdesc \(max-height:\s*1\.19em\)\s*\{[^}]*\.tc-desc\s*\{[^}]*display:\s*none/);
    });

    it('readable floors (times a phone text size): a name 12px (10px for a long word fitted to the width), a description 11px', () => {
      expect(rule('.tc')).toMatch(/--name-nominal:\s*calc\(max\(12px,\s*10cqmin\)\s*\*\s*var\(--tk\)\)/);
      expect(rule('.tc-name')).toMatch(/font-size:\s*max\(calc\(10px \* var\(--tk\)\),\s*min\(var\(--name-nominal\),\s*var\(--name-fit\)\)\)/);
      expect(rule('.tc')).toMatch(/--desc-font:\s*calc\(max\(11px,/);
    });

    it('a camel-case name may break between its parts (<wbr>), never mid-word', async () => {
      const { container } = render(Entry, { entry: { ...entry, name: 'HomeAssistant', size: 'small' }, fit: 'compact' });
      await tick();
      const name = container.querySelector('.tc-name')!;
      expect(name.textContent!.trim()).toBe('HomeAssistant');
      expect(name.querySelectorAll('wbr')).toHaveLength(1);
      expect(Number((container.querySelector('.tc-box') as HTMLElement).style.getPropertyValue('--name-seg-em')))
        .toBeLessThan(Number((container.querySelector('.tc-box') as HTMLElement).style.getPropertyValue('--name-word-em')));
    });

    it('the description is the tile\'s accessible description, shown or not', async () => {
      const { container } = render(Entry, { entry: { ...entry, description: 'Vision and stats', size: 'small' }, fit: 'compact' });
      await tick();
      const btn = container.querySelector('button.entry')!;
      const id = btn.getAttribute('aria-describedby')!;
      expect(id).toBeTruthy();
      expect(document.getElementById(id)!.textContent).toBe('Vision and stats');
    });

    it('a Small name takes two lines, and one below the two-line size', () => {
      expect(css).toMatch(/\.small \.tc-name\s*\{[^}]*-webkit-line-clamp:\s*2/);
      expect(css).toMatch(/@container tc \(max-height:\s*47\.99px\)\s*\{[^}]*\.small \.tc-name[^}]*\{[^}]*white-space:\s*nowrap/);
      expect(SMALL_TWO_LINES_MIN_PX).toBe(50);
    });
  });
});

// Item 16 / 19: a coloured tile's text follows the ONE rule folders use (most readable), or the
// tile's own Light / Dark choice.
describe('Entry text colour', () => {
  const textOf = (c: HTMLElement) => (c.querySelector('button.entry') as HTMLElement).style.getPropertyValue('--tile-text');

  it('#3b82f6 gives black text (as a folder in the same colour does)', async () => {
    const { container } = render(Entry, { entry: { ...entry, color: '#3b82f6' } });
    await tick();
    expect(textOf(container)).toBe('#000000');
    expect(container.querySelector('button.entry')?.classList.contains('custom-color')).toBe(true);
  });

  it('a dark colour gives white text; Light and Dark are used as chosen', async () => {
    const a = render(Entry, { entry: { ...entry, color: '#0f172a' } });
    await tick();
    expect(textOf(a.container)).toBe('#ffffff');
    a.unmount();
    const b = render(Entry, { entry: { ...entry, color: '#3b82f6', textColor: 'light' } });
    await tick();
    expect(textOf(b.container)).toBe('#ffffff');
    b.unmount();
    const c = render(Entry, { entry: { ...entry, color: '#0f172a', textColor: 'dark' } });
    await tick();
    expect(textOf(c.container)).toBe('#000000');
  });

  it('a note tile uses it for its heading and body too', () => {
    const css = readFileSync(resolve(__dirname, 'Entry.svelte'), 'utf8');
    expect(css).toMatch(/\.entry\.custom-color \.note-title,\s*\.entry\.custom-color \.note-body\s*\{\s*color:\s*var\(--tile-text\)/);
  });

  it('no colour: the theme text (no override)', async () => {
    const { container } = render(Entry, { entry: { ...entry, textColor: 'light' } });
    await tick();
    expect(textOf(container)).toBe('');
    expect(container.querySelector('button.entry')?.classList.contains('custom-color')).toBe(false);
  });

  it('#rrggbbaa and #rgba (e.g. a Heimdall import) draw exactly as stored; the text uses the rgb part', async () => {
    for (const [c, want] of [['#3b82f680', '#000000'], ['#0f172acc', '#ffffff'], ['#00f8', '#ffffff']] as const) {
      const { container, unmount } = render(Entry, { entry: { ...entry, color: c }, editorSelected: false });
      await tick();
      // The same colour CSS draws for the stored value (no fallback to the theme).
      const ref = document.createElement('div');
      ref.style.backgroundColor = c;
      expect(ref.style.backgroundColor).not.toBe('');
      expect((container.querySelector('.entry-bg') as HTMLElement).style.backgroundColor).toBe(ref.style.backgroundColor);
      expect(textOf(container)).toBe(want);
      expect(container.querySelector('[data-testid="tile-colour-unreadable"]')).toBeNull();
      unmount();
    }
  });

  it('a colour that cannot be read draws the theme and says so in the editor', async () => {
    const { container } = render(Entry, { entry: { ...entry, color: 'bluish' }, editorSelected: false });
    await tick();
    expect(textOf(container)).toBe('');
    expect((container.querySelector('.entry-bg') as HTMLElement).style.backgroundColor).toBe('');
    expect(container.querySelector('[data-testid="tile-colour-unreadable"]')?.textContent).toMatch(/Colour can't be read/);
  });
});

describe('the hover popup (no native title): the name, then the description, then any notes', () => {
  const card = () => document.body.querySelector('[data-testid="hover-card"]') as HTMLElement | null;
  const lines = () => Array.from(card()?.querySelectorAll('.hc-line') ?? []).map((l) => l.textContent);
  const show = async (btn: HTMLElement) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    btn.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await tick();
  };
  beforeEach(() => {
    resetHoverCard();
    awayMode.set(false);
    render(HoverCard);
  });
  afterEach(() => awayMode.set(false));

  it('name only', async () => {
    const { container } = render(Entry, { entry });
    const btn = container.querySelector('button.entry') as HTMLElement;
    expect(btn.hasAttribute('title')).toBe(false);
    await show(btn);
    expect(card()?.querySelector('.hc-name')?.textContent).toBe('Plain');
    expect(card()?.querySelector('.hc-desc')).toBeNull();
    expect(lines()).toEqual([]);
  });

  it('name and description (the name first, larger; the description its accessible description)', async () => {
    const { container } = render(Entry, { entry: { ...entry, description: 'The plain one' } });
    const btn = container.querySelector('button.entry') as HTMLElement;
    await show(btn);
    expect(card()?.querySelector('.hc-name')?.textContent).toBe('Plain');
    expect(card()?.querySelector('.hc-desc')?.textContent).toBe('The plain one');
    expect(document.getElementById(btn.getAttribute('aria-describedby')!)?.textContent).toBe('The plain one');
  });

  it('away: the away address and the home-check note, as before', async () => {
    awayMode.set(true);
    const { container } = render(Entry, {
      entry: { ...entry, awayUrl: 'https://away.example', statusCheck: { enabled: true } } as EntryType
    });
    await show(container.querySelector('button.entry') as HTMLElement);
    expect(lines()).toEqual(['Opens away address: https://away.example', 'Status checked at home address']);
  });

  it('an address problem is a note in the popup', async () => {
    const { container } = render(Entry, { entry: { ...entry, url: '' } });
    await show(container.querySelector('button.entry') as HTMLElement);
    expect(lines()).toEqual(['No address: this tile will not open']);
  });

  it('the Recently used chip has the same popup and no native title', async () => {
    const { container } = render(Entry, { entry: { ...entry, description: 'D' }, chip: true });
    const chip = container.querySelector('.recent-chip') as HTMLElement;
    expect(chip.hasAttribute('title')).toBe(false);
    expect(document.getElementById(chip.getAttribute('aria-describedby')!)?.textContent).toBe('D');
    await show(chip);
    expect(card()?.querySelector('.hc-desc')?.textContent).toBe('D');
  });
});
