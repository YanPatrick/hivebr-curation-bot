import * as fs from 'fs';
import * as path from 'path';

// Temporary diagnostics to decide the next cost cut (see
// docs/superpowers/specs/2026-11-21-night-sleep-design.md, "Diagnósticos"):
// production RAM is ~150 MB versus ~75 MB measured locally, and the volume
// shows 1.2 GB used although the bot's own files are a few KB. Remove these
// once the numbers are in.

const MB = 1048576;
const MAX_VOLUME_ENTRIES = 10;

type Log = (line: string) => void;

const toMb = (bytes: number) => Math.round(bytes / MB);

function formatBytes(bytes: number): string {
  return bytes < MB ? `${Math.round(bytes / 1024)} KB` : `${(bytes / MB).toFixed(1)} MB`;
}

export function formatMemoryUsage(m: NodeJS.MemoryUsage): string {
  return `Memória: rss=${toMb(m.rss)}MB heapUsed=${toMb(m.heapUsed)}MB heapTotal=${toMb(m.heapTotal)}MB external=${toMb(m.external)}MB`;
}

// Logs now and then every intervalMs. Returns a function that stops it.
export function startMemoryLog(intervalMs: number, log: Log = console.log): () => void {
  const logNow = () => log(formatMemoryUsage(process.memoryUsage()));
  logNow();
  const timer = setInterval(logNow, intervalMs);
  return () => clearInterval(timer);
}

async function entrySize(fullPath: string): Promise<number> {
  const stat = await fs.promises.lstat(fullPath);
  if (!stat.isDirectory()) return stat.size;

  let total = 0;
  for (const child of await fs.promises.readdir(fullPath)) {
    try {
      total += await entrySize(path.join(fullPath, child));
    } catch {
      // unreadable entry: skip it
    }
  }
  return total;
}

// Direct children of dir with their sizes (directories summed recursively),
// largest first. Entries that can't be read are skipped.
export async function directorySizes(dir: string): Promise<{ name: string; bytes: number }[]> {
  const sizes: { name: string; bytes: number }[] = [];
  for (const name of await fs.promises.readdir(dir)) {
    try {
      sizes.push({ name, bytes: await entrySize(path.join(dir, name)) });
    } catch {
      // unreadable entry: skip it
    }
  }
  return sizes.sort((a, b) => b.bytes - a.bytes);
}

// Never rejects: a diagnostic must not take the bot down.
export async function logVolumeUsage(dir: string, log: Log = console.log): Promise<void> {
  try {
    if (typeof fs.promises.statfs === 'function') {
      const stats = await fs.promises.statfs(dir);
      const used = (stats.blocks - stats.bfree) * stats.bsize;
      log(`Volume ${dir}: usado ${toMb(used)} MB de ${toMb(stats.blocks * stats.bsize)} MB`);
    }
    for (const { name, bytes } of (await directorySizes(dir)).slice(0, MAX_VOLUME_ENTRIES)) {
      log(`  ${name}: ${formatBytes(bytes)}`);
    }
  } catch (error) {
    log(`Não foi possível analisar o volume ${dir}: ${(error as Error).message}`);
  }
}
