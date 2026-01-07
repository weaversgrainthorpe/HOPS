import { writable } from 'svelte/store';
import { browser } from '$app/environment';

export type TextSize = 'small' | 'medium' | 'large' | 'xlarge';

interface TextSizeConfig {
  label: string;
  fontSize: string;
  scale: number;
}

export const textSizeConfigs: Record<TextSize, TextSizeConfig> = {
  small: { label: 'Small', fontSize: '14px', scale: 0.875 },
  medium: { label: 'Medium', fontSize: '16px', scale: 1 },
  large: { label: 'Large', fontSize: '18px', scale: 1.125 },
  xlarge: { label: 'Extra Large', fontSize: '20px', scale: 1.25 }
};

const textSizeOrder: TextSize[] = ['small', 'medium', 'large', 'xlarge'];

// Get initial text size from localStorage or default to 'medium'
const getInitialTextSize = (): TextSize => {
  if (!browser) return 'medium';
  const stored = localStorage.getItem('hops_text_size');
  if (stored && stored in textSizeConfigs) {
    return stored as TextSize;
  }
  return 'medium';
};

export const textSize = writable<TextSize>(getInitialTextSize());

// Apply text size to document
function applyTextSize(size: TextSize) {
  if (!browser) return;

  const config = textSizeConfigs[size];
  const root = document.documentElement;

  root.style.setProperty('--text-size-base', config.fontSize);
  root.style.setProperty('--text-size-scale', config.scale.toString());
  root.style.fontSize = config.fontSize;

  localStorage.setItem('hops_text_size', size);
}

// Subscribe to text size changes and update DOM
if (browser) {
  textSize.subscribe(applyTextSize);

  // Apply initial text size
  applyTextSize(getInitialTextSize());
}

export function increaseTextSize() {
  textSize.update((current) => {
    const currentIndex = textSizeOrder.indexOf(current);
    if (currentIndex < textSizeOrder.length - 1) {
      return textSizeOrder[currentIndex + 1];
    }
    return current;
  });
}

export function decreaseTextSize() {
  textSize.update((current) => {
    const currentIndex = textSizeOrder.indexOf(current);
    if (currentIndex > 0) {
      return textSizeOrder[currentIndex - 1];
    }
    return current;
  });
}

export function setTextSize(size: TextSize) {
  textSize.set(size);
}

export function canIncrease(current: TextSize): boolean {
  return textSizeOrder.indexOf(current) < textSizeOrder.length - 1;
}

export function canDecrease(current: TextSize): boolean {
  return textSizeOrder.indexOf(current) > 0;
}
