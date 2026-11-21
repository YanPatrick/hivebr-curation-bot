import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { formatMemoryUsage, startMemoryLog, directorySizes, logVolumeUsage } from './diagnostics';

const MB = 1048576;

test('formatMemoryUsage', () =>
  assert.equal(
    formatMemoryUsage({ rss: 150 * MB, heapUsed: 25 * MB, heapTotal: 30 * MB, external: 5 * MB, arrayBuffers: 0 }),
    'Memória: rss=150MB heapUsed=25MB heapTotal=30MB external=5MB',
  ));

test('directorySizes sums subdirectories', async () => {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'diag-'));
  try {
    await fs.promises.writeFile(path.join(dir, 'a'), Buffer.alloc(1000));
    await fs.promises.mkdir(path.join(dir, 'sub'));
    await fs.promises.writeFile(path.join(dir, 'sub', 'b'), Buffer.alloc(3000));
    await fs.promises.writeFile(path.join(dir, 'sub', 'c'), Buffer.alloc(2000));
    assert.deepEqual(await directorySizes(dir), [
      { name: 'sub', bytes: 5000 },
      { name: 'a', bytes: 1000 },
    ]);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
});

test('logVolumeUsage on missing dir resolves and logs', async () => {
  const lines: string[] = [];
  await logVolumeUsage(path.join(os.tmpdir(), 'does-not-exist-' + Date.now()), (line) => lines.push(line));
  assert.ok(lines.some((line) => line.startsWith('Não foi possível analisar o volume')), lines.join('\n'));
});

test('startMemoryLog logs immediately and stops', () => {
  const lines: string[] = [];
  const stop = startMemoryLog(10_000, (line) => lines.push(line));
  try {
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^Memória: rss=\d+MB/);
  } finally {
    stop();
  }
});
