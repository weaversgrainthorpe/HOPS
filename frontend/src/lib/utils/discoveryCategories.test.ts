// The discovery category list mirrors the backend catalogue
// (backend/internal/discovery/categories.go); the Go test
// TestFrontendCategoryListMirrorsCatalogue checks the two agree row for row.
import { describe, it, expect } from 'vitest';
import { CATEGORY_LIST, categoryLabel, categoryIcon } from './api';

describe('discovery CATEGORY_LIST', () => {
  it('includes the AI category with its label and icon', () => {
    expect(categoryLabel('ai')).toBe('AI');
    expect(categoryIcon('ai')).toBe('mdi:robot');
  });

  it('is alphabetical by label, AI first', () => {
    const labels = CATEGORY_LIST.map((c) => c.label.toLowerCase());
    expect(labels).toEqual([...labels].sort());
    expect(CATEGORY_LIST[0].slug).toBe('ai');
  });
});
