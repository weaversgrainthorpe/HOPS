// Mock for $app/navigation used in tests (tests that assert on calls vi.mock it).
export async function goto(_url: string | URL, _opts?: unknown): Promise<void> {}
export async function invalidate(_dep: unknown): Promise<void> {}
export async function invalidateAll(): Promise<void> {}
export function beforeNavigate(_cb: unknown): void {}
export function afterNavigate(_cb: unknown): void {}
