import { test } from '@playwright/test';
import * as fs from 'node:fs';
import { BEFORE_BOXES, captureBoxes, importFixtures, sortKeys } from '../boxes';

// Captures the pixel box of every [data-node-id] element and every tab button, for every tab of
// every fixture dashboard, at 1280x900 and 1920x1080, into fixtures/grid-before-boxes.json.
//
// Run it ONCE on the pre-change build (finer-grid plan, Task 0) to record the "before" boxes;
// e2e/finer-grid.spec.ts compares the post-change build against that file, with the same code
// (../boxes.ts).
//
//   npx playwright test --config=capture-boxes.config.ts
//
// Deterministic by construction: ids come from the fixtures, keys are sorted, numbers are rounded
// to 0.01 px, and the layout is awaited by polling (frames), never by sleeping.

test('capture the pre-change layout boxes', async ({ page, context }) => {
  test.setTimeout(240_000);
  const stored = await importFixtures(page, context);
  const result = await captureBoxes(page, stored);
  fs.writeFileSync(BEFORE_BOXES, JSON.stringify(sortKeys(result), null, 1) + '\n');
});
