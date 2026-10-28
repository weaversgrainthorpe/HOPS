import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

// Test-harness-only switch (NOT an app setting): HOPS_TEST_BUILD=release runs the suite against the real
// release binary (scripts/build.sh: UI embedded, no -tags dev, no --frontend flag). Default is the dev
// build (backend/hops-testdev, UI served from frontend/build).
export const RELEASE = process.env.HOPS_TEST_BUILD === 'release';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Command + args for a spec that spawns its own HOPS. */
export function hopsCommand(dataDir: string): [string, string[]] {
	const base = ['--data', dataDir, '--host', '127.0.0.1'];
	if (RELEASE) return [path.join(REPO, 'backend/hops'), base];
	// --no-lan-multicast: Discovery sends no mDNS/SSDP onto the real LAN from a test run.
	return [path.join(REPO, 'backend/hops-testdev'), [...base, '--frontend', path.join(REPO, 'frontend/build'), '--no-lan-multicast']];
}

/** Specs that truly need the dev build skip visibly in release mode (never silently). */
export const DEV_ONLY_REASON = 'needs the -tags dev build (--frontend flag); not applicable to the release binary';
