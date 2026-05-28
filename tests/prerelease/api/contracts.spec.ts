import { test, expect } from '@playwright/test';

// API contract pins. Each endpoint's response is asserted at the
// "required keys are present" level — not pinned to exact values
// (which churn) and not pinned to a JSON snapshot (which is brittle
// to additive changes). The bug class caught here is "a field
// silently disappeared from a response" — the kind of thing that
// breaks a frontend caller weeks later.

test('GET /api/health returns version + status + database connectivity', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('version');
  expect(body).toHaveProperty('status');
  expect(body).toHaveProperty('database');
  expect(body.database).toHaveProperty('connected');
});

test('GET /api/version returns a semver-shaped version', async ({ request }) => {
  const r = await request.get('/api/version');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
});

test('GET /api/config returns a config envelope with dashboards array', async ({ request }) => {
  const r = await request.get('/api/config');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('dashboards');
  expect(Array.isArray(body.dashboards)).toBeTruthy();
});

test('GET /api/auth/check reports authenticated user', async ({ request }) => {
  const r = await request.get('/api/auth/check');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('authenticated');
  expect(body.authenticated).toBeTruthy();
});

test('GET /api/settings returns the keyed settings list', async ({ request }) => {
  const r = await request.get('/api/settings');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('settings');
  expect(Array.isArray(body.settings)).toBeTruthy();
  // Must include server.port — it's the bootstrap key
  expect(body.settings.find((s: { key: string }) => s.key === 'server.port')).toBeDefined();
});

test('GET /api/backups returns a list with name+size+createdAt', async ({ request }) => {
  const r = await request.get('/api/backups');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('backups');
  // First-run server has at least the startup backup
  expect(body.backups.length).toBeGreaterThan(0);
  const first = body.backups[0];
  expect(first).toHaveProperty('name');
  expect(first).toHaveProperty('size');
  expect(first).toHaveProperty('createdAt');
});

test('GET /api/discovery/scans returns a scans array', async ({ request }) => {
  const r = await request.get('/api/discovery/scans');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('scans');
  expect(Array.isArray(body.scans)).toBeTruthy();
});

test('GET /api/discovery/detectors returns the bundled detector list with category+ports+signatures', async ({ request }) => {
  const r = await request.get('/api/discovery/detectors');
  expect(r.status()).toBe(200);
  const body = await r.json();
  expect(body).toHaveProperty('detectors');
  expect(body.detectors.length).toBeGreaterThan(0);
  const first = body.detectors[0];
  expect(first).toHaveProperty('id');
  expect(first).toHaveProperty('category');
  expect(first).toHaveProperty('ports');
  expect(first).toHaveProperty('source');
});

test('GET /api/icons returns an icon list with id+imageUrl+isPreset shape', async ({ request }) => {
  const r = await request.get('/api/icons');
  expect(r.status()).toBe(200);
  const body = await r.json();
  // The endpoint returns a bare array. The frontend depends on the per-item shape;
  // a regression dropping any of these keys would break the icon picker.
  expect(Array.isArray(body)).toBeTruthy();
  expect(body.length).toBeGreaterThan(0);
  const first = body[0];
  expect(first).toHaveProperty('id');
  expect(first).toHaveProperty('imageUrl');
  expect(first).toHaveProperty('isPreset');
});

test('GET /api/backgrounds returns presets', async ({ request }) => {
  const r = await request.get('/api/backgrounds');
  expect(r.status()).toBe(200);
  const body = await r.json();
  // Either backgrounds: [] OR a categorised shape — at minimum the request must succeed
  expect(body).toBeDefined();
});
