import { readdir, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const names = ['OPENROUTER_API_KEY', 'FRED_API_KEY', 'UPSTASH_REDIS_REST_TOKEN', 'REDIS_PASSWORD'];
const needles = names.map(name => process.env[name]).filter(Boolean);
assert.ok(needles.length > 0, 'Supply server-only canaries or local cache secrets to check');
let count = 0;
async function scan(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = `${dir}/${item.name}`;
    if (item.isDirectory()) await scan(path);
    else {
      const bytes = await readFile(path);
      for (const value of needles) assert.ok(!bytes.includes(Buffer.from(value)), `Credential/canary found in ${path}`);
      count++;
    }
  }
}
await scan('dist');
console.log(JSON.stringify({ filesScanned: count, secretValuesChecked: needles.length, matches: 0 }));
