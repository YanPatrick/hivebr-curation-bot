import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

// Point this at a mounted persistent volume in production (e.g. Railway
// Volumes) — otherwise these files live on the container's ephemeral
// filesystem and get wiped on every deploy.
const DATA_DIR = process.env.DATA_DIR || '.';

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const BLACKLIST_FILE = path.join(DATA_DIR, 'blacklist.json');
const STAFF_FILE = path.join(DATA_DIR, 'staff.json');
const AUTO_FILE = path.join(DATA_DIR, 'auto.json');

// One-time bootstrap for a freshly created (empty) volume: if DATA_DIR is
// pointed at a persistent volume and a file isn't there yet, copy it in
// from the committed seed snapshot. Once the file exists on the volume,
// this is a permanent no-op — it will never overwrite live data again.
const SEED_DIR = path.join(__dirname, '..', 'seed-data');

async function seedIfMissing(seedFile: string, targetFile: string): Promise<void> {
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

export async function seedDataFiles(): Promise<void> {
  await seedIfMissing(path.join(SEED_DIR, 'staff.json'), STAFF_FILE);
  await seedIfMissing(path.join(SEED_DIR, 'users.json'), USERS_FILE);
  await seedIfMissing(path.join(SEED_DIR, 'blacklist.json'), BLACKLIST_FILE);
  await seedIfMissing(path.join(SEED_DIR, 'auto.json'), AUTO_FILE);
}

export const getStaffUsers = async (): Promise<{ hiveUsername: string; discordId: string }[]> => {
    try {
      const data = await readFile(STAFF_FILE, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      console.error(`Could not read users from ${STAFF_FILE}:`, (error as Error).message);
      return [];
    }
};
  
export const saveStaffUsers = async (users: { hiveUsername: string; discordId: string }[]): Promise<void> => {
  try {
    await writeFile(STAFF_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${STAFF_FILE}:`, (error as Error).message);
  }
};

// Helper function to check if a user is in the staff list
export async function isUserInStaffList(discordId: string): Promise<boolean> {
    const staffUsers = await getStaffUsers();
    return staffUsers.some(user => user.discordId === discordId);
  }

// Rename getUsersToMonitor to getVerifiedUsers
export const getVerifiedUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(USERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${USERS_FILE}:`, (error as Error).message);
    return [];
  }
};

// Rename saveUsersToMonitor to saveVerifiedUsers
export const saveVerifiedUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${USERS_FILE}:`, (error as Error).message);
  }
};

export const getBlacklistedUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(BLACKLIST_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${BLACKLIST_FILE}:`, (error as Error).message);
    return [];
  }
};

export const saveBlacklistedUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(BLACKLIST_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${BLACKLIST_FILE}:`, (error as Error).message);
  }
};

export const getAutoUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(AUTO_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${AUTO_FILE}:`, (error as Error).message);
    return [];
  }
};

export const saveAutoUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(AUTO_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${AUTO_FILE}:`, (error as Error).message);
  }
};

export const getLastProcessedBlock = async (filePath: string): Promise<number> => {
  try {
    const data = await readFile(filePath, 'utf-8');
    return parseInt(data, 10) || 0;
  } catch (error) {
    console.error(`Could not read last processed block from ${filePath}:`, (error as Error).message);
    return 0;
  }
};

export const updateLastProcessedBlock = async (filePath: string, blockNumber: number): Promise<void> => {
  try {
    await writeFile(filePath, blockNumber.toString());
  } catch (error) {
    console.error(`Could not write last processed block to ${filePath}:`, (error as Error).message);
  }
};