import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BackgroundSection from './BackgroundSection.svelte';
import {
  backgroundCapabilities,
  BACKGROUND_CASES,
  type BackgroundCase
} from '$lib/components/background/backgroundCapabilities';
import type { Background } from '$lib/types';

// The dialog renders ONLY from the capability table. For every level x context x form
// state the controls on screen are exactly the ones the table lists — no control without an
// effect. (The table's own values are pinned by hand in backgroundCapabilities.test.ts; a few are
// also written out by hand below.)
vi.mock('$lib/utils/api', () => ({
  getBackgrounds: vi.fn().mockResolvedValue({ categories: [], images: [] }),
  uploadBackground: vi.fn(),
  deleteBackground: vi.fn(),
  createBackgroundCategory: vi.fn()
}));

const IMGS = ['/presets/network-grid.jpg', '/presets/dark-gradient.jpg'];
const slideshow = (opacity = 1): Background => ({
  type: 'slideshow', images: [...IMGS], interval: 42, transition: 'kenburns', transitionDuration: 2.5,
  overlayOpacity: 0.3, overlayBlur: 4, opacity
});
/** The stored background that gives this case's form state (see-through = opacity below 1). */
const bgFor = (c: BackgroundCase) => slideshow(c.form.seeThrough ? 0.8 : 1);
const TYPE_LABEL = { none: 'None', color: 'Color', image: 'Image', slideshow: 'Slideshow' } as const;
const name = (c: BackgroundCase) => `${c.level} ${JSON.stringify(c.runtime)} ${JSON.stringify(c.form)}`;
const SEE_THROUGH_NOTE = "A see-through tab uses the dashboard's darkness and blur.";

function typeButtons(): string[] {
  return Array.from(document.querySelectorAll('[aria-labelledby="bg-type-label"] button')).map((b) => b.textContent?.trim() ?? '');
}

beforeEach(() => vi.clearAllMocks());

describe('BackgroundSection renders exactly the capability table', () => {
  for (const c of BACKGROUND_CASES) {
    {
      it(name(c), () => {
        const caps = backgroundCapabilities(c.level, c.runtime, c.form);
        render(BackgroundSection, { level: c.level, runtime: c.runtime, background: bgFor(c), onOpenDashboardSettings: () => {} });

        expect(typeButtons()).toEqual(caps.pictureTypes.map((t) => TYPE_LABEL[t]));
        expect(document.getElementById('bg-type-label')?.textContent).toContain(caps.typeLabel);

        const has = (q: () => unknown) => q() !== null;
        expect(has(() => screen.queryByLabelText(/^Rotation Interval/)), 'interval').toBe(caps.interval);
        expect(has(() => screen.queryByRole('group', { name: 'Transition Effect' })), 'transition picker').toBe(caps.transitionPicker);
        expect(has(() => screen.queryByLabelText(/^Transition Duration/)), 'duration').toBe(caps.duration);
        expect(has(() => screen.queryByRole('button', { name: 'Ken Burns' })), 'Ken Burns').toBe(caps.kenBurns);
        expect(has(() => screen.queryByText(/Transition Preview/)), 'preview').toBe(caps.transitionPicker);
        expect(has(() => screen.queryByText(/^Overlay Darkness/)), 'overlay').toBe(caps.overlay);
        expect(has(() => screen.queryByText(/^Overlay Blur/)), 'blur').toBe(caps.overlay);
        expect(has(() => screen.queryByLabelText(/^Background opacity/)), 'opacity').toBe(caps.opacity);
        expect(has(() => screen.queryByText(SEE_THROUGH_NOTE)), 'see-through note').toBe(caps.overlayNote === 'seeThroughTab');

        const folderNote = screen.queryByText(/on this dashboard\. Turn on 'Animated folder backgrounds' in Dashboard settings to play them\./);
        expect(folderNote !== null, 'folder-animations note').toBe(caps.motionNotes.includes('folderAnimationsOff'));
        expect(screen.queryByRole('button', { name: 'Open Dashboard settings' }) !== null, 'settings link').toBe(
          caps.motionNotes.includes('folderAnimationsOff')
        );
        const reducedNote = screen.queryByText(/on this device, because it asks for reduced motion/);
        expect(reducedNote !== null, 'reduced-motion note').toBe(caps.motionNotes.includes('reducedMotion'));

        if (caps.inherit.kind === 'switch') {
          expect(screen.getByRole('switch', { name: caps.inherit.ownLabel })).toBeInTheDocument();
        } else {
          expect(screen.getByRole('radiogroup', { name: caps.inherit.groupLabel })).toBeInTheDocument();
          expect(screen.getByRole('radio', { name: caps.inherit.inheritLabel })).toBeInTheDocument();
          expect(screen.getByRole('radio', { name: caps.inherit.ownLabel })).toBeInTheDocument();
        }
      });
    }
  }

  // Written out by hand (not derived from the table).
  it('by hand: folder, animations off — the note and the link; no transition, interval, duration or overlay', () => {
    render(BackgroundSection, {
      level: 'folder', runtime: { folderAnimationsOn: false, reducedMotion: false }, background: slideshow(), onOpenDashboardSettings: () => {}
    });
    expect(screen.getByText(/^Pictures show as the first image, still, on this dashboard\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open Dashboard settings' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Transition Effect' })).toBeNull();
    expect(screen.queryByLabelText(/^Rotation Interval/)).toBeNull();
    expect(screen.queryByLabelText(/^Transition Duration/)).toBeNull();
    expect(screen.queryByText(/^Overlay Darkness/)).toBeNull();
    expect(screen.getByLabelText(/^Background opacity/)).toBeInTheDocument();
  });

  it('by hand: tab, see-through — the note in place of darkness and blur; motion controls stay', () => {
    render(BackgroundSection, { level: 'tab', runtime: { reducedMotion: false }, background: slideshow(0.6) });
    expect(screen.getByText(SEE_THROUGH_NOTE)).toBeInTheDocument();
    expect(screen.queryByText(/^Overlay Darkness/)).toBeNull();
    expect(screen.queryByText(/^Overlay Blur/)).toBeNull();
    expect(screen.getByRole('group', { name: 'Transition Effect' })).toBeInTheDocument();
  });

  it('by hand: moving the tab opacity slider switches the overlay controls and the note live', async () => {
    const { component } = render(BackgroundSection, { level: 'tab', runtime: { reducedMotion: false }, background: slideshow(1) });
    const slider = screen.getByLabelText(/^Background opacity/);
    expect(screen.getByText(/^Overlay Darkness/)).toBeInTheDocument();
    expect(screen.queryByText(SEE_THROUGH_NOTE)).toBeNull();
    await fireEvent.input(slider, { target: { value: '0.5' } });
    expect(screen.queryByText(/^Overlay Darkness/)).toBeNull();
    expect(screen.getByText(SEE_THROUGH_NOTE)).toBeInTheDocument();
    // Saved see-through: the stored darkness and blur are kept exactly.
    const r = (component as unknown as { build(): { ok: boolean; value?: Background } }).build();
    expect(r).toEqual({ ok: true, value: { ...slideshow(), opacity: 0.5 } });
    await fireEvent.input(slider, { target: { value: '1' } });
    expect(screen.getByText(/^Overlay Darkness/)).toBeInTheDocument();
    expect(screen.queryByText(SEE_THROUGH_NOTE)).toBeNull();
  });

  it('the settings link calls the host', async () => {
    const onOpenDashboardSettings = vi.fn();
    render(BackgroundSection, {
      level: 'folder', runtime: { folderAnimationsOn: false, reducedMotion: false }, background: slideshow(), onOpenDashboardSettings
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open Dashboard settings' }));
    expect(onOpenDashboardSettings).toHaveBeenCalledTimes(1);
  });

  it('hidden motion controls: the stored values are saved unchanged (no silent loss)', async () => {
    for (const c of BACKGROUND_CASES) {
      const caps = backgroundCapabilities(c.level, c.runtime, c.form);
      if (caps.interval && caps.overlay) continue;
      // Out-of-range stored timing would be clamped by a visible control; hidden, it is kept as is.
      const bg: Background = { ...bgFor(c), interval: 1, transitionDuration: 99 };
      const { component, unmount } = render(BackgroundSection, { level: c.level, runtime: c.runtime, background: structuredClone(bg) });
      if (!caps.interval) expect(screen.queryByText(/is outside/)).toBeNull();
      const r = (component as unknown as { build(): { ok: boolean; value?: Background } }).build();
      if (caps.interval) {
        // Visible timing is clamped; only the hidden overlay is checked here.
        expect(r.value, name(c)).toMatchObject({ overlayOpacity: 0.3, overlayBlur: 4 });
      } else {
        expect(r, name(c)).toEqual({ ok: true, value: bg });
      }
      unmount();
    }
  });

  it('an unknown stored transition ("fade") is shown as Crossfade, said so, and saved as crossfade', async () => {
    const bg: Background = { ...slideshow(), transition: 'fade' as Background['transition'] };
    const { component } = render(BackgroundSection, {
      level: 'dashboard', runtime: { folderAnimationsOn: true, reducedMotion: false }, background: structuredClone(bg)
    });
    expect(screen.getByRole('button', { name: 'Crossfade' }).classList.contains('active')).toBe(true);
    expect(screen.getByText(/The stored transition \("fade"\) isn't one HOPS knows/)).toBeTruthy();
    const r = (component as unknown as { build(): { ok: boolean; value?: Background } }).build();
    expect(r.value).toMatchObject({ transition: 'crossfade' });
  });

  it('a known stored transition shows no note and saves unchanged', () => {
    const { component } = render(BackgroundSection, {
      level: 'dashboard', runtime: { folderAnimationsOn: true, reducedMotion: false }, background: slideshow()
    });
    expect(screen.queryByText(/isn't one HOPS knows/)).toBeNull();
    const r = (component as unknown as { build(): { ok: boolean; value?: Background } }).build();
    expect(r.value).toMatchObject({ transition: 'kenburns' });
  });

  it('switching Image -> Slideshow with motion hidden keeps the stored timing fields', async () => {
    const bg: Background = { type: 'image', value: IMGS[0], interval: 77, transition: 'flip', transitionDuration: 3 };
    const { component } = render(BackgroundSection, {
      level: 'folder', runtime: { folderAnimationsOn: false, reducedMotion: false }, background: structuredClone(bg)
    });
    await fireEvent.click(screen.getByRole('button', { name: /^Slideshow$/ }));
    expect(screen.queryByLabelText(/^Rotation Interval/)).toBeNull();
    // Pick an image so the slideshow can be saved.
    await fireEvent.input(screen.getByLabelText(/^Add Custom Image URL/), { target: { value: IMGS[1] } });
    await fireEvent.click(screen.getByRole('button', { name: /^Add$/ }));
    const r = (component as unknown as { build(): { ok: boolean; value?: Background } }).build();
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({ type: 'slideshow', interval: 77, transition: 'flip', transitionDuration: 3, images: [IMGS[1]] });
  });
});
