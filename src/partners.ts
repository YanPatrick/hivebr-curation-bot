import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { seedIfMissing } from './data-files';

const readFile = promisify(fs.readFile);
const writeFile = promisify(fs.writeFile);

const DATA_DIR = process.env.DATA_DIR || '.';

const PARTNERS_FILE = path.join(DATA_DIR, 'partners.json');
const PARTNER_WEIGHT_FILE = path.join(DATA_DIR, 'partner-vote-weight.txt');

const DEFAULT_PARTNER_VOTE_WEIGHT = 50;

const SEED_DIR = path.join(__dirname, '..', 'seed-data');

export async function seedPartnerDataFiles(): Promise<void> {
  await seedIfMissing(path.join(SEED_DIR, 'partners.json'), PARTNERS_FILE);
  await seedIfMissing(path.join(SEED_DIR, 'partner-vote-weight.txt'), PARTNER_WEIGHT_FILE);
}

export const getPartnerUsers = async (): Promise<string[]> => {
  try {
    const data = await readFile(PARTNERS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Could not read users from ${PARTNERS_FILE}:`, (error as Error).message);
    return [];
  }
};

export const savePartnerUsers = async (users: string[]): Promise<void> => {
  try {
    await writeFile(PARTNERS_FILE, JSON.stringify(users, null, 2));
  } catch (error) {
    console.error(`Could not write users to ${PARTNERS_FILE}:`, (error as Error).message);
  }
};

export const getPartnerVoteWeight = async (): Promise<number> => {
  try {
    const data = await readFile(PARTNER_WEIGHT_FILE, 'utf-8');
    const value = parseFloat(data);
    return Number.isNaN(value) ? DEFAULT_PARTNER_VOTE_WEIGHT : value;
  } catch (error) {
    console.error(`Could not read vote weight from ${PARTNER_WEIGHT_FILE}:`, (error as Error).message);
    return DEFAULT_PARTNER_VOTE_WEIGHT;
  }
};

export const setPartnerVoteWeight = async (value: number): Promise<void> => {
  try {
    await writeFile(PARTNER_WEIGHT_FILE, value.toString());
  } catch (error) {
    console.error(`Could not write vote weight to ${PARTNER_WEIGHT_FILE}:`, (error as Error).message);
  }
};
