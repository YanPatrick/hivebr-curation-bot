import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// One-time bootstrap for a freshly created (empty) volume: if the target
// file isn't there yet, copy it in from the committed seed snapshot. Once
// the file exists on the volume, this is a permanent no-op — it will
// never overwrite live data again.
export async function seedIfMissing(seedFile: string, targetFile: string): Promise<void> {
  if (path.resolve(seedFile) === path.resolve(targetFile)) return;

  try {
    await fs.promises.access(targetFile);
    return;
  } catch {
    // target doesn't exist yet — fall through to seed it
  }

  try {
    const seedData = await readFile(seedFile, 'utf-8');
    await fs.promises.mkdir(path.dirname(targetFile), { recursive: true });
    await writeFile(targetFile, seedData);
    console.log(`Seeded ${targetFile} from ${seedFile}`);
  } catch (error) {
    console.error(`Could not seed ${targetFile} from ${seedFile}:`, (error as Error).message);
  }
}
