// Mock for $app/environment used in tests.
// SvelteKit normally provides these flags via its virtual module system.
export const browser = true;
export const dev = true;
export const building = false;
export const version = 'test';
