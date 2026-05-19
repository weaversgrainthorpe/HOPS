// One-shot script: load HOPS prod DB via SSH, surgically remove demo cruft,
// write back. Designed to be reversed by restoring hops.db.demo-backup.
//
// Removes:
//   - The entire "Main (Copy)" tab
//   - The entire "Multimedia" tab
//   - The SECOND "Home Assitant Development" group on the Main tab (keeps the first)
//
// Run: node cleanup-for-demo.mjs

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';

const PROD = 'jonathan@10.10.0.9';
const DB = '/home/jonathan/HOPS/data/hops.db';

console.log('▸ fetching current config from prod');
const json = execSync(`ssh ${PROD} 'sqlite3 ${DB} "SELECT data FROM config WHERE id=1"'`, { encoding: 'utf8' });
const config = JSON.parse(json);

let removed = { tabs: 0, groups: 0 };
for (const dash of config.dashboards) {
  if (dash.name !== 'Weavers') continue;
  const before = dash.tabs.length;
  dash.tabs = dash.tabs.filter(t => t.name !== 'Main (Copy)' && t.name !== 'Multimedia');
  removed.tabs += before - dash.tabs.length;

  for (const tab of dash.tabs) {
    // De-dupe groups by name within a tab, keeping the FIRST occurrence
    const seen = new Set();
    const beforeGroups = tab.groups.length;
    tab.groups = tab.groups.filter(g => {
      if (seen.has(g.name)) return false;
      seen.add(g.name);
      return true;
    });
    removed.groups += beforeGroups - tab.groups.length;
  }
}

console.log(`▸ removed ${removed.tabs} tabs, ${removed.groups} duplicate groups`);

const cleanedJson = JSON.stringify(config);
await fs.writeFile('/tmp/hops-cleaned.json', cleanedJson);

console.log('▸ copying cleaned config to prod');
execSync(`scp -q /tmp/hops-cleaned.json ${PROD}:/tmp/`, { stdio: 'inherit' });

console.log('▸ stopping hops, writing cleaned config, starting');
execSync(`ssh ${PROD} 'sudo systemctl stop hops'`, { stdio: 'inherit' });
execSync(`ssh ${PROD} 'python3 -c "import sqlite3; d=open(\\"/tmp/hops-cleaned.json\\").read(); c=sqlite3.connect(\\"${DB}\\"); c.execute(\\"UPDATE config SET data=?, updated_at=CURRENT_TIMESTAMP WHERE id=1\\", (d,)); c.commit(); c.close(); print(\\"ok\\")"'`, { stdio: 'inherit' });
execSync(`ssh ${PROD} 'sudo systemctl start hops'`, { stdio: 'inherit' });
execSync(`sleep 1`, { stdio: 'inherit' });

console.log('▸ post-cleanup state');
const verifyJson = execSync(`ssh ${PROD} 'curl -s http://localhost:8080/api/config'`, { encoding: 'utf8' });
const verify = JSON.parse(verifyJson);
for (const dash of verify.dashboards) {
  if (dash.name !== 'Weavers') continue;
  for (const tab of dash.tabs) {
    for (const g of tab.groups) {
      console.log(`  ${tab.name} > ${g.name} (${g.entries.length} tiles)`);
    }
  }
}
