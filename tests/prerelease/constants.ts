// Constants shared across setup + specs. Lives outside any *.spec.ts /
// setup.ts so importing it doesn't trigger Playwright's test() registration.

export const ADMIN_USERNAME = 'admin';
export const ADMIN_INITIAL_PASSWORD = 'admin';
export const ADMIN_TEST_PASSWORD = 'TestPass123!';
