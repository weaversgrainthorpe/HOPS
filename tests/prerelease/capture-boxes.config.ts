import { defineConfig } from '@playwright/test';
import base from './playwright.config';

// Config for scripts/capture-boxes.ts only (it is not a *.spec.ts, so the normal suite never runs it).
// Run:  npx playwright test --config=capture-boxes.config.ts
// It reuses the throwaway server and the setup (sign-in) project from the main config.
export default defineConfig({
  ...base,
  testMatch: [/setup\.ts$/, /scripts\/capture-boxes\.ts$/],
  projects: base.projects!.map((p) =>
    p.name === 'chromium' ? { ...p, testMatch: /scripts\/capture-boxes\.ts$/ } : p
  ),
});
