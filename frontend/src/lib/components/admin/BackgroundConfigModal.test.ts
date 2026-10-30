import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte';
import BackgroundConfigModal from './BackgroundConfigModal.svelte';
import type { Background } from '$lib/types';

// One picker at every level.
const getBackgrounds = vi.fn();
vi.mock('$lib/utils/api', () => ({
  getBackgrounds: (...a: unknown[]) => getBackgrounds(...a),
  uploadBackground: vi.fn(),
  deleteBackground: vi.fn(),
  createBackgroundCategory: vi.fn()
}));

beforeEach(() => {
  getBackgrounds.mockReset();
  getBackgrounds.mockResolvedValue({ categories: [], images: [] });
});

type Level = 'dashboard' | 'tab' | 'folder';
/** Slideshows animate here: every control the level has is shown. */
const MOVING = { folderAnimationsOn: true, reducedMotion: false };
function open(level: Level, background?: Background) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  render(BackgroundConfigModal, { runtime: MOVING, level, background, onSave, onCancel });
  return { onSave, onCancel };
}
const save = () => fireEvent.click(screen.getByRole('button', { name: /^Save Background/ }));
// Plain wording per level: the dashboard has a switch "Show background picture"
// (on = not inherit); tab and folder have a two-choice radio group.
const sameOption = () => screen.getByRole('radio', { name: /^Same as / }) as HTMLInputElement;
const ownOption = () => screen.getByRole('radio', { name: 'Its own background' }) as HTMLInputElement;
const showSwitch = () => screen.getByRole('switch', { name: 'Show background picture' }) as HTMLInputElement;
// Folder level: pictures only — "No picture of its own — show what's behind" / "Its own picture".
const behindOption = () => screen.getByRole('radio', { name: "No picture of its own — show what's behind" }) as HTMLInputElement;
const pictureOption = () => screen.getByRole('radio', { name: 'Its own picture' }) as HTMLInputElement;
/** Is "inherit" currently on, whichever control this level has? */
function inheritIsOn(level: Level): boolean {
  return level === 'dashboard' ? !showSwitch().checked : level === 'folder' ? behindOption().checked : sameOption().checked;
}
/** Click the control that turns inherit on (to = true) or off. */
async function setInherit(level: Level, to: boolean) {
  if (level === 'dashboard') {
    if (showSwitch().checked === to) await fireEvent.click(showSwitch());
  } else if (level === 'folder') {
    await fireEvent.click(to ? behindOption() : pictureOption());
  } else {
    await fireEvent.click(to ? sameOption() : ownOption());
  }
}

describe('BackgroundConfigModal at every level', () => {
  it('has a title per level', () => {
    for (const [level, title] of [['dashboard', 'Dashboard background'], ['tab', 'Tab background'], ['folder', 'Folder background']] as const) {
      const { unmount } = render(BackgroundConfigModal, { runtime: MOVING, level, onSave: vi.fn(), onCancel: vi.fn() });
      expect(screen.getByRole('heading', { level: 2 }).textContent).toMatch(new RegExp(title, 'i'));
      unmount();
    }
  });

  it('has no per-tab toggle any more', () => {
    open('dashboard', { type: 'image', value: '/presets/network-grid.jpg' });
    expect(screen.queryByText(/Individual backgrounds per tab/i)).toBeNull();
  });

  it('folder level hides the overlay darkness and blur; tab level shows them', () => {
    const bg: Background = { type: 'image', value: '/presets/network-grid.jpg' };
    const { unmount } = render(BackgroundConfigModal, { runtime: MOVING, level: 'folder', background: bg, onSave: vi.fn(), onCancel: vi.fn() });
    expect(screen.queryByText(/Overlay Darkness/i)).toBeNull();
    expect(screen.queryByText(/Overlay Blur/i)).toBeNull();
    unmount();
    open('tab', bg);
    expect(screen.getByText(/Overlay Darkness/i)).toBeInTheDocument();
    expect(screen.getByText(/Overlay Blur/i)).toBeInTheDocument();
  });

  it('folder level never writes overlay fields (a picture picked there has none)', async () => {
    const { onSave } = open('folder');
    await fireEvent.click(pictureOption());
    await fireEvent.click(screen.getByRole('button', { name: /^Image$/ }));
    await fireEvent.input(screen.getByLabelText(/^Image URL/), { target: { value: '/presets/network-grid.jpg' } });
    await save();
    const out = onSave.mock.calls[0][0] as Background;
    expect(out).toMatchObject({ type: 'image', value: '/presets/network-grid.jpg' });
    expect(out).not.toHaveProperty('overlayOpacity');
    expect(out).not.toHaveProperty('overlayBlur');
  });

  it('picking a picture listed under several names selects exactly one card', async () => {
    open('dashboard', { type: 'image', value: '/presets/dark-gradient.jpg' });
    const card = await screen.findByTitle('Network Grid');
    await fireEvent.click(card);
    expect(document.querySelectorAll('.image-card.selected')).toHaveLength(1);
    expect(document.querySelectorAll('.image-card img[src="/presets/network-grid.jpg"]')).toHaveLength(1);
  });

  describe('plain on/off wording per level', () => {
    const pic: Background = { type: 'image', value: '/presets/network-grid.jpg' };
    const kept = { inherit: true, ...pic } as Background;

    it('dashboard: a labelled switch "Show background picture", on by default', () => {
      open('dashboard', pic);
      expect(showSwitch().checked).toBe(true);
      expect(screen.getByText('Shown behind the whole dashboard.')).toBeInTheDocument();
      expect(screen.queryByText(/keep this picture stored/i)).toBeNull();
    });
    it('dashboard off: says the picture is kept', () => {
      open('dashboard', kept);
      expect(showSwitch().checked).toBe(false);
      expect(screen.getByText('No picture. Your chosen picture is kept, so turning this back on restores it.')).toBeInTheDocument();
    });
    it('tab: a radio group, "Same as the dashboard" / "Its own background"', () => {
      open('tab', pic);
      const group = screen.getByRole('radiogroup', { name: /tab background/i });
      expect(group).toBeInTheDocument();
      expect(sameOption().labels?.[0].textContent?.trim()).toBe('Same as the dashboard');
      expect(ownOption().checked).toBe(true);
      expect(screen.queryByRole('switch')).toBeNull();
    });
    it('tab same-as: the kept-picture help text', () => {
      open('tab', kept);
      expect(sameOption().checked).toBe(true);
      expect(screen.getByText("This tab's own picture is kept for when you switch back.")).toBeInTheDocument();
    });
    it('folder: "No picture of its own — show what\'s behind" / "Its own picture"', () => {
      open('folder', kept);
      expect(screen.getByRole('radiogroup', { name: /folder background/i })).toBeInTheDocument();
      expect(behindOption().checked).toBe(true);
      expect(pictureOption().checked).toBe(false);
      expect(screen.queryByRole('radio', { name: /^Same as / })).toBeNull();
      expect(screen.getByText("This folder's own picture is kept for when you switch back.")).toBeInTheDocument();
    });
    it('folder with no background starts on "No picture of its own"', () => {
      open('folder');
      expect(behindOption().checked).toBe(true);
    });
    it('no level, in either state, says "uses the background below"', () => {
      for (const level of ['dashboard', 'tab', 'folder'] as const) {
        for (const bg of [pic, kept]) {
          const { unmount } = render(BackgroundConfigModal, { runtime: MOVING, level, background: bg, onSave: vi.fn(), onCancel: vi.fn() });
          expect(document.body.textContent).not.toMatch(/uses the background below/i);
          unmount();
        }
      }
    });
    it('choosing "Same as" sets inherit:true and keeps the picture; switching back restores it', async () => {
      const { onSave } = open('folder', { ...pic, opacity: 0.4 });
      await fireEvent.click(behindOption());
      await save();
      expect(onSave.mock.calls[0][0]).toEqual({ ...pic, opacity: 0.4, inherit: true });
      document.body.innerHTML = '';
      const r = open('folder', structuredClone(onSave.mock.calls[0][0]));
      await fireEvent.click(pictureOption());
      await save();
      expect(r.onSave.mock.calls[0][0]).toEqual({ ...pic, opacity: 0.4 });
    });
  });

  describe('exact round trip', () => {
    const cases: [Level, Background][] = [
      ['dashboard', { type: 'slideshow', images: ['/presets/network-grid.jpg'], interval: 40, transition: 'kenburns', transitionDuration: 2, overlayOpacity: 0.4, overlayBlur: 3 }],
      ['tab', { type: 'image', value: '/backgrounds/a.jpg' }],
      ['folder', { type: 'color', value: '#123456', opacity: 0.3 }],
      ['folder', { type: 'image', value: '/presets/network-grid.jpg', overlayOpacity: 0.3, fit: 'contain' }],
      ['tab', { inherit: true, type: 'slideshow', images: ['/backgrounds/a.jpg'], value: '/backgrounds/old.jpg' }],
      ['tab', { inherit: true }],
      ['folder', { type: 'image', value: '/backgrounds/a.jpg', future: { x: 1 } } as unknown as Background]
    ];
    for (const [level, bg] of cases) {
      it(`a no-op open + Save gives back an equal background (${level}: ${JSON.stringify(bg)})`, async () => {
        const { onSave } = open(level, structuredClone(bg));
        await save();
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave.mock.calls[0][0]).toEqual(bg);
      });
    }

    it('an unknown key survives Inherit on and off', async () => {
      const bg = { type: 'image', value: '/backgrounds/a.jpg', future: 'kept' } as unknown as Background;
      let r = open('tab', structuredClone(bg));
      await setInherit('tab', true);
      await save();
      const on = r.onSave.mock.calls[0][0];
      expect(on).toEqual({ ...bg, inherit: true });
      document.body.innerHTML = '';
      r = open('tab', structuredClone(on));
      await setInherit('tab', false);
      await save();
      expect(r.onSave.mock.calls[0][0]).toEqual(bg);
    });

    it('a slideshow keeps a stored value, and changing one field writes only that field', async () => {
      const bg: Background = { type: 'slideshow', images: ['/presets/network-grid.jpg'], value: '/backgrounds/old.jpg' };
      const { onSave } = open('folder', structuredClone(bg));
      await fireEvent.input(screen.getByLabelText(/^Background opacity/), { target: { value: '0.5' } });
      await save();
      expect(onSave.mock.calls[0][0]).toEqual({ ...bg, opacity: 0.5 });
    });

    it('an unsafe saved slideshow image is reported inline and blocks Save (never re-saved silently)', async () => {
      const { onSave } = open('tab', { type: 'slideshow', images: ['/presets/network-grid.jpg', 'javascript:alert(1)'] });
      const alerts = () => screen.getAllByRole('alert').map((a) => a.textContent ?? '');
      expect(alerts().some((t) => /can't be used/i.test(t) && t.includes('javascript:alert(1)'))).toBe(true);
      await save();
      expect(onSave).not.toHaveBeenCalled();
      expect(alerts().some((t) => /remove it to save/i.test(t))).toBe(true);
    });
  });

  it('Inherit keeps the stored picture and sets inherit: true', async () => {
    const images = ['/presets/network-grid.jpg', '/presets/data-center.jpg'];
    const { onSave } = open('tab', { type: 'slideshow', images, interval: 40 });
    expect(inheritIsOn('tab')).toBe(false);
    await setInherit('tab', true);
    expect(screen.getByText(/own picture is kept/i)).toBeInTheDocument();
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inherit: true, type: 'slideshow', images, interval: 40 }));
  });

  it('Inherit keeps a single image value', async () => {
    const { onSave } = open('folder', { type: 'image', value: '/backgrounds/a.jpg' });
    await setInherit('folder', true);
    await save();
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ inherit: true, type: 'image', value: '/backgrounds/a.jpg' }));
  });

  it('turning Inherit off restores the kept picture', async () => {
    const { onSave } = open('dashboard', { inherit: true, type: 'image', value: '/backgrounds/a.jpg', opacity: 0.4 });
    expect(inheritIsOn('dashboard')).toBe(true);
    await setInherit('dashboard', false);
    await save();
    const out = onSave.mock.calls[0][0] as Background;
    expect(out).toMatchObject({ type: 'image', value: '/backgrounds/a.jpg', opacity: 0.4 });
    expect(out.inherit).toBeFalsy();
  });

  it('a bare inherit form opens with Inherit on and saves as inherit', async () => {
    const { onSave } = open('tab', { inherit: true });
    expect(inheritIsOn('tab')).toBe(true);
    await save();
    expect(onSave).toHaveBeenCalledWith({ inherit: true });
  });

  it('one opacity slider writes background.opacity (0–1)', async () => {
    const { onSave } = open('folder', { type: 'image', value: '/presets/network-grid.jpg' });
    const slider = screen.getByLabelText(/^Background opacity/) as HTMLInputElement;
    expect(slider.type).toBe('range');
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('1');
    expect(slider.value).toBe('1');
    await fireEvent.input(slider, { target: { value: '0.5' } });
    await save();
    expect((onSave.mock.calls[0][0] as Background).opacity).toBe(0.5);
  });

  it('a stored out-of-range opacity is clamped', async () => {
    const { onSave } = open('tab', { type: 'color', value: '#112233', opacity: 7 });
    await save();
    expect((onSave.mock.calls[0][0] as Background).opacity).toBe(1);
  });

  it('a colour background gets the opacity slider too (dashboard and tab levels)', () => {
    open('tab', { type: 'color', value: '#112233' });
    expect(screen.getByLabelText(/^Background opacity/)).toBeInTheDocument();
  });

  it('an invalid custom URL shows an inline error and is not added', async () => {
    const { onSave } = open('tab', { type: 'slideshow', images: ['/presets/network-grid.jpg'] });
    const input = screen.getByLabelText(/Add Custom Image URL/i);
    for (const bad of ['javascript:alert(1)', '/api/config', 'ftp://x.example/a.jpg', '/backgrounds/../api/x']) {
      await fireEvent.input(input, { target: { value: bad } });
      await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
      const err = screen.getByRole('alert');
      expect(err.textContent).toMatch(/can't be used/i);
      expect(input.getAttribute('aria-invalid')).toBe('true');
    }
    await save();
    expect((onSave.mock.calls[0][0] as Background).images).toEqual(['/presets/network-grid.jpg']);
  });

  it('a valid custom URL is added (and clears the error)', async () => {
    const { onSave } = open('tab', { type: 'slideshow', images: [] });
    const input = screen.getByLabelText(/Add Custom Image URL/i);
    await fireEvent.input(input, { target: { value: 'javascript:alert(1)' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await fireEvent.input(input, { target: { value: 'https://img.example.com/photo (1).jpg' } });
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(screen.queryByRole('alert')).toBeNull();
    await save();
    expect((onSave.mock.calls[0][0] as Background).images).toEqual(['https://img.example.com/photo (1).jpg']);
  });

  it('an invalid single image URL blocks Save with a visible error', async () => {
    const { onSave } = open('tab', { type: 'image', value: '/presets/network-grid.jpg' });
    await fireEvent.input(screen.getByLabelText(/^Image URL/), { target: { value: 'javascript:alert(1)' } });
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByRole('alert').some((a) => /can't be used/i.test(a.textContent ?? ''))).toBe(true);
  });

  it('an empty slideshow is refused visibly', async () => {
    const { onSave } = open('folder', { type: 'slideshow', images: [] });
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/at least one image/i);
  });

  it('None saves no background (tab level)', async () => {
    const { onSave } = open('tab', { type: 'image', value: '/presets/network-grid.jpg' });
    await fireEvent.click(screen.getByRole('button', { name: /^None$/ }));
    await save();
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('a failed library load is visible (bundled presets only)', async () => {
    getBackgrounds.mockRejectedValue(new Error('HTTP 500'));
    open('tab', { type: 'image', value: '/presets/network-grid.jpg' });
    await waitFor(() => expect(screen.getByText(/couldn't load your uploaded images/i)).toBeInTheDocument());
  });

  describe('slideshow timing is bounded', () => {
    const imgs = ['/presets/network-grid.jpg', '/presets/dark-gradient.jpg'];
    const interval = () => screen.getByLabelText(/^Rotation Interval/) as HTMLInputElement;
    const duration = () => screen.getByLabelText(/^Transition Duration/) as HTMLInputElement;

    it('the inputs carry the bounds', () => {
      open('tab', { type: 'slideshow', images: imgs });
      expect(interval().min).toBe('5');
      expect(interval().max).toBe('3600');
      expect(duration().min).toBe('0.5');
      expect(duration().max).toBe('5');
    });

    it('a stored out-of-range value is shown clamped, says so, and is saved clamped (never refused)', async () => {
      const { onSave } = open('tab', { type: 'slideshow', images: imgs, interval: 0.1, transitionDuration: 1e9 });
      expect(interval().value).toBe('5');
      expect(duration().value).toBe('5');
      expect(screen.getByText(/stored interval \(0\.1\) is outside 5–3600 s; it is used as 5 s/i)).toBeInTheDocument();
      expect(screen.getByText(/stored transition duration \(1000000000\) is outside 0\.5–5 s; it is used as 5 s/i)).toBeInTheDocument();
      await save();
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave.mock.calls[0][0]).toEqual({ type: 'slideshow', images: imgs, interval: 5, transitionDuration: 5 });
    });

    it('a typed value outside the bounds is clamped in the input and on Save', async () => {
      const { onSave } = open('tab', { type: 'slideshow', images: imgs, interval: 30 });
      await fireEvent.input(interval(), { target: { value: '0.1' } });
      await fireEvent.change(interval());
      expect(interval().value).toBe('5');
      await fireEvent.input(interval(), { target: { value: '99999' } });
      await fireEvent.change(interval());
      expect(interval().value).toBe('3600');
      // Typed and saved without a change event: still clamped.
      await fireEvent.input(interval(), { target: { value: '-5' } });
      await save();
      expect(onSave.mock.calls[0][0]).toEqual({ type: 'slideshow', images: imgs, interval: 5 });
      expect(interval().value).toBe('5');
    });

    it('in-range values show no note and round-trip unchanged', async () => {
      const bg: Background = { type: 'slideshow', images: imgs, interval: 120, transitionDuration: 1.5 };
      const { onSave } = open('tab', structuredClone(bg));
      expect(screen.queryByText(/is outside/i)).toBeNull();
      await save();
      expect(onSave.mock.calls[0][0]).toEqual(bg);
    });
  });
});

// The folder background is pictures only. Edit Folder owns the folder's colour; the
// dashboard and tab levels keep every option; a stored folder colour background is never dropped.
describe('folder background: pictures only', () => {
  const typeButtons = () =>
    Array.from(document.querySelectorAll('[aria-labelledby="bg-type-label"] button')).map((b) => b.textContent?.trim());

  it('"Its own picture" offers Image and Slideshow only — no Color, no None', async () => {
    open('folder');
    expect(screen.queryByRole('button', { name: /^Image$/ })).toBeNull(); // nothing to pick until "Its own picture"
    await fireEvent.click(pictureOption());
    expect(typeButtons()).toEqual(['Image', 'Slideshow']);
    expect(screen.queryByRole('button', { name: /^Color$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^None$/ })).toBeNull();
  });

  it('the dashboard and tab levels keep None, Color, Image and Slideshow', () => {
    for (const level of ['dashboard', 'tab'] as const) {
      const { unmount } = render(BackgroundConfigModal, { runtime: MOVING, level, onSave: vi.fn(), onCancel: vi.fn() });
      expect(typeButtons()).toEqual(['None', 'Color', 'Image', 'Slideshow']);
      unmount();
    }
  });

  it('"Its own picture" with nothing picked is refused visibly (never saved as nothing)', async () => {
    const { onSave } = open('folder');
    await fireEvent.click(pictureOption());
    await save();
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Choose an image/i);
  });

  it('no background, untouched: Save gives back no background', async () => {
    const { onSave } = open('folder');
    await save();
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('a kept picture can be removed for good ("Remove it")', async () => {
    const { onSave } = open('folder', { inherit: true, type: 'image', value: '/presets/network-grid.jpg' });
    await fireEvent.click(screen.getByRole('button', { name: /^Remove it/ }));
    expect(screen.queryByText(/own picture is kept/i)).toBeNull();
    await save();
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  describe('a stored colour background (from before folders took their colour from Edit Folder)', () => {
    const colourBg: Background = { type: 'color', value: '#123456', opacity: 0.6 };
    const legacyOption = () => screen.getByRole('radio', { name: /^Colour background \(set the folder colour instead\)/ }) as HTMLInputElement;

    it('is shown as "Colour background (set the folder colour instead)", ticked, with its colour', () => {
      open('folder', colourBg);
      expect(legacyOption().checked).toBe(true);
      expect(screen.getByText(/#123456/)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Color$/ })).toBeNull();
    });

    it('is kept exactly when saved untouched (never dropped silently), switched on or off', async () => {
      for (const bg of [colourBg, { ...colourBg, inherit: true }, { ...colourBg, future: 1 } as unknown as Background]) {
        const { onSave } = open('folder', structuredClone(bg));
        await save();
        expect(onSave.mock.calls[0][0]).toEqual(bg);
        document.body.innerHTML = '';
      }
    });

    it('"Use as folder colour" hands the colour to the folder dialog', async () => {
      const onUseAsFolderColour = vi.fn();
      render(BackgroundConfigModal, { runtime: MOVING, level: 'folder', background: colourBg, onSave: vi.fn(), onCancel: vi.fn(), onUseAsFolderColour });
      await fireEvent.click(screen.getByRole('button', { name: 'Use as folder colour' }));
      expect(onUseAsFolderColour).toHaveBeenCalledTimes(1);
    });

    it('a colour that is not #rrggbb says why it cannot be used (no button)', () => {
      render(BackgroundConfigModal, { runtime: MOVING,
        level: 'folder', background: { type: 'color', value: 'rebeccapurple' }, onSave: vi.fn(), onCancel: vi.fn(), onUseAsFolderColour: vi.fn()
      });
      expect(screen.queryByRole('button', { name: 'Use as folder colour' })).toBeNull();
      expect(screen.getByText(/rebeccapurple.*can't be used as the folder colour/)).toBeInTheDocument();
    });

    it('choosing "No picture of its own" removes it, and says so before Save', async () => {
      const { onSave } = open('folder', colourBg);
      await fireEvent.click(behindOption());
      expect(screen.getByText(/colour background is removed when you save/i)).toBeInTheDocument();
      await save();
      expect(onSave).toHaveBeenCalledWith(undefined);
    });

    it('choosing "Its own picture" replaces it with a picture', async () => {
      const { onSave } = open('folder', colourBg);
      await fireEvent.click(pictureOption());
      await fireEvent.input(screen.getByLabelText(/^Image URL/), { target: { value: '/presets/network-grid.jpg' } });
      await save();
      expect(onSave.mock.calls[0][0]).toMatchObject({ type: 'image', value: '/presets/network-grid.jpg' });
    });
  });
});
