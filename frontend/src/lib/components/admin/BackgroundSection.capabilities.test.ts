import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import BackgroundSection from './BackgroundSection.svelte';
import {
  backgroundCapabilities,
  BACKGROUND_LEVELS,
  ALL_BACKGROUND_CONTEXTS,
  type BackgroundContext
} from '$lib/components/background/backgroundCapabilities';
import type { Background } from '$lib/types';

// M6 §8.2: the dialog renders ONLY from the capability table. For every level x context the
// controls on screen are exactly the ones the table lists — no control without an effect.
vi.mock('$lib/utils/api', () => ({
  getBackgrounds: vi.fn().mockResolvedValue({ categories: [], images: [] }),
  uploadBackground: vi.fn(),
  deleteBackground: vi.fn(),
  createBackgroundCategory: vi.fn()
}));

const IMGS = ['/presets/network-grid.jpg', '/presets/dark-gradient.jpg'];
const slideshow = (): Background => ({
  type: 'slideshow', images: [...IMGS], interval: 42, transition: 'kenburns', transitionDuration: 2.5,
  overlayOpacity: 0.3, overlayBlur: 4, opacity: 0.8
});
const TYPE_LABEL = { none: 'None', color: 'Color', image: 'Image', slideshow: 'Slideshow' } as const;
const name = (c: BackgroundContext) => `folderAnimationsOn=${c.folderAnimationsOn} reducedMotion=${c.reducedMotion}`;

function typeButtons(): string[] {
  return Array.from(document.querySelectorAll('[aria-labelledby="bg-type-label"] button')).map((b) => b.textContent?.trim() ?? '');
}

beforeEach(() => vi.clearAllMocks());

describe('BackgroundSection renders exactly the capability table (M6 §8.2)', () => {
  for (const level of BACKGROUND_LEVELS) {
    for (const context of ALL_BACKGROUND_CONTEXTS) {
      it(`${level}, ${name(context)}`, () => {
        const caps = backgroundCapabilities(level, context);
        render(BackgroundSection, { level, runtime: context, background: slideshow(), onOpenDashboardSettings: () => {} });

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

  it('the settings link calls the host', async () => {
    const onOpenDashboardSettings = vi.fn();
    render(BackgroundSection, {
      level: 'folder', runtime: { folderAnimationsOn: false, reducedMotion: false }, background: slideshow(), onOpenDashboardSettings
    });
    await fireEvent.click(screen.getByRole('button', { name: 'Open Dashboard settings' }));
    expect(onOpenDashboardSettings).toHaveBeenCalledTimes(1);
  });

  it('hidden motion controls: the stored values are saved unchanged (no silent loss)', async () => {
    for (const level of BACKGROUND_LEVELS) {
      for (const context of ALL_BACKGROUND_CONTEXTS) {
        if (backgroundCapabilities(level, context).interval) continue;
        // Out-of-range stored timing would be clamped by a visible control; hidden, it is kept as is.
        const bg: Background = { ...slideshow(), interval: 1, transitionDuration: 99 };
        if (level === 'folder') {
          delete bg.overlayOpacity;
          delete bg.overlayBlur;
        }
        const { component, unmount } = render(BackgroundSection, { level, runtime: context, background: structuredClone(bg) });
        expect(screen.queryByText(/is outside/)).toBeNull();
        const r = (component as unknown as { build(): { ok: boolean; value?: Background } }).build();
        expect(r, `${level} ${name(context)}`).toEqual({ ok: true, value: bg });
        unmount();
      }
    }
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
