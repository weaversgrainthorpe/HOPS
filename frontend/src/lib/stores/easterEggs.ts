import { writable, get } from 'svelte/store';
import { editMode } from './editMode';

// Konami Code sequence: ↑↑↓↓←→←→BA
const KONAMI_CODE = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'KeyB', 'KeyA'];

// Easter egg states
export const partyModeActive = writable(false);
export const hopAnimationActive = writable(false);

// Track key sequence for Konami Code
let keySequence: string[] = [];
let konamiTimeout: ReturnType<typeof setTimeout> | null = null;

// Initialize keyboard listener for Konami Code
export function initEasterEggs() {
  if (typeof window === 'undefined') return;

  window.addEventListener('keydown', handleKeyDown);
}

// Cleanup listener
export function destroyEasterEggs() {
  if (typeof window === 'undefined') return;

  window.removeEventListener('keydown', handleKeyDown);
  if (konamiTimeout) {
    clearTimeout(konamiTimeout);
  }
}

function handleKeyDown(e: KeyboardEvent) {
  // Only track when in edit mode
  if (!get(editMode)) return;

  // Reset sequence after 2 seconds of no input
  if (konamiTimeout) {
    clearTimeout(konamiTimeout);
  }
  konamiTimeout = setTimeout(() => {
    keySequence = [];
  }, 2000);

  // Add key to sequence
  keySequence.push(e.code);

  // Keep only the last N keys (length of Konami Code)
  if (keySequence.length > KONAMI_CODE.length) {
    keySequence.shift();
  }

  // Check for Konami Code match
  if (keySequence.length === KONAMI_CODE.length) {
    const isKonami = keySequence.every((key, i) => key === KONAMI_CODE[i]);
    if (isKonami) {
      triggerPartyMode();
      keySequence = [];
    }
  }
}

// Trigger Party Mode
export function triggerPartyMode() {
  if (get(partyModeActive)) return;

  partyModeActive.set(true);

  // Auto-disable after 5 seconds
  setTimeout(() => {
    partyModeActive.set(false);
  }, 5000);
}

// Trigger Hop Animation (called from hidden interaction)
export function triggerHopAnimation() {
  if (get(hopAnimationActive)) return;

  hopAnimationActive.set(true);

  // Auto-disable after animation completes (~3 seconds)
  setTimeout(() => {
    hopAnimationActive.set(false);
  }, 3000);
}

// Disable edit mode also disables easter eggs
editMode.subscribe(enabled => {
  if (!enabled) {
    partyModeActive.set(false);
    hopAnimationActive.set(false);
  }
});
