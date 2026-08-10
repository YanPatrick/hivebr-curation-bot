# Partner Whitelist (list_parceiros) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the bot auto-detect posts from whitelisted partner authors (`list_parceiros`) directly on the Hive blockchain and publish them in the curation Discord channel with a fixed, staff-configurable vote weight and a manual vote button — replacing the current manual `!vote author/permlink 50` workflow for the Japanese-community partnership.

**Architecture:** `processBlock` gains a second detection path alongside the existing `hivebr`/`hive-br` tag check: when a top-level post's author is in `partners.json` (and the tag didn't already match), a new `processPartnerPost` function runs the same safety checks as the community flow (blacklist, Hivewatchers, same-day dedupe, edit filtering) but skips the scoring engine entirely, posting a visually distinct embed with a fixed vote weight pulled from persistent storage. List membership and vote weight are managed through new staff-only Discord commands (`!add`, `!remove`, `!setvalue`, `!list`, all scoped to `list_parceiros`).

**Tech Stack:** TypeScript, discord.js v14, @hiveio/dhive, Node.js/ts-node. No automated test framework exists anywhere in this repo (zero test files) — this plan follows that existing convention. Each task is verified with a throwaway script or a live manual run of the bot instead of a unit-test suite; see the note at the start of each task's verification step.

## Global Constraints

- One flat partner list (`list_parceiros`), no named sub-groups — a deliberate v1 simplification agreed with the team.
- One vote weight, global to the whole list, not per-author. Default 50%, changeable at runtime via `!setvalue list_parceiros <valor>`, persisted across restarts.
- Partner posts are always manual (a "🚀 VOTE!" button) in this version — no auto-voting path.
- The existing `!vote author/permlink valor` command is untouched and remains the manual escape hatch for authors outside the whitelist.
- Tag match (`hivebr`/`hive-br`) takes priority over whitelist match — if both apply, the post goes through the normal community scoring flow, not the partner flow.
- Blacklist and Hivewatchers checks apply to partner posts exactly like they do to community posts — a blacklisted author is never voted, even if present in `list_parceiros`.
- New commands are staff-only, gated the same way as `!staff`/`!ban`/`!verify` etc.

---

### Task 1: Shared seed helper + partner data module

**Files:**
- Create: `src/data-files.ts`
- Create: `src/partners.ts`
- Modify: `src/users.ts:1-49`
- Create: `seed-data/partners.json`
- Create: `seed-data/partner-vote-weight.txt`
- Modify: `.env.example:5-9`

**Interfaces:**
- Produces (consumed by Task 2 and Task 3):
  - `seedIfMissing(seedFile: string, targetFile: string): Promise<void>` — `./data-files`
  - `getPartnerUsers(): Promise<string[]>` — `./partners`
  - `savePartnerUsers(users: string[]): Promise<void>` — `./partners`
  - `getPartnerVoteWeight(): Promise<number>` — `./partners`
  - `setPartnerVoteWeight(value: number): Promise<void>` — `./partners`
  - `seedPartnerDataFiles(): Promise<void>` — `./partners`

- [ ] **Step 1: Extract the seed helper into its own module**

`src/users.ts` currently defines a local `seedIfMissing` function that `partners.ts` also needs. Pull it into a shared module instead of duplicating it.

Create `src/data-files.ts`:

```typescript
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
```

- [ ] **Step 2: Point `src/users.ts` at the shared helper**

In `src/users.ts`, replace this block (lines 1-49):

```typescript
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
```

with:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { seedIfMissing } from './data-files';

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

export async function seedDataFiles(): Promise<void> {
  await seedIfMissing(path.join(SEED_DIR, 'staff.json'), STAFF_FILE);
  await seedIfMissing(path.join(SEED_DIR, 'users.json'), USERS_FILE);
  await seedIfMissing(path.join(SEED_DIR, 'blacklist.json'), BLACKLIST_FILE);
  await seedIfMissing(path.join(SEED_DIR, 'auto.json'), AUTO_FILE);
}
```

(The rest of `src/users.ts` — `getStaffUsers` through `updateLastProcessedBlock` — is unchanged.)

- [ ] **Step 3: Create the seed files**

Create `seed-data/partners.json`:

```json
[]
```

Create `seed-data/partner-vote-weight.txt`:

```
50
```

- [ ] **Step 4: Document the new files in `.env.example`**

Replace this block (lines 5-9):

```
# diretorio onde staff.json, users.json, blacklist.json e auto.json sao
# lidos/gravados. Em producao (Railway), aponte para o mount path de um
# Volume (ex: /data) para que essas listas sobrevivam a cada deploy.
# Deixe em branco para usar a raiz do projeto (uso local/dev).
DATA_DIR=
```

with:

```
# diretorio onde staff.json, users.json, blacklist.json, auto.json,
# partners.json e partner-vote-weight.txt sao lidos/gravados. Em producao
# (Railway), aponte para o mount path de um Volume (ex: /data) para que
# essas listas sobrevivam a cada deploy. Deixe em branco para usar a raiz
# do projeto (uso local/dev).
DATA_DIR=
```

- [ ] **Step 5: Create `src/partners.ts`**

```typescript
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
```

- [ ] **Step 6: Write a throwaway verification script**

Create `verify-task1.ts` in the project root (this file is temporary, deleted in Step 8):

```typescript
import {
  seedPartnerDataFiles,
  getPartnerUsers,
  savePartnerUsers,
  getPartnerVoteWeight,
  setPartnerVoteWeight,
} from './src/partners';

(async () => {
  await seedPartnerDataFiles();
  console.log('After seed -> users:', await getPartnerUsers(), 'weight:', await getPartnerVoteWeight());

  await savePartnerUsers(['testauthor']);
  console.log('After savePartnerUsers -> users:', await getPartnerUsers());

  await setPartnerVoteWeight(40);
  console.log('After setPartnerVoteWeight(40) -> weight:', await getPartnerVoteWeight());
})();
```

- [ ] **Step 7: Run it and confirm the output**

Run (Bash/git-bash):

```bash
DATA_DIR=./tmp-verify-data npx ts-node verify-task1.ts
```

Expected output (order matters, exact array/number values matter):

```
Seeded tmp-verify-data/partners.json from seed-data/partners.json
Seeded tmp-verify-data/partner-vote-weight.txt from seed-data/partner-vote-weight.txt
After seed -> users: [] weight: 50
After savePartnerUsers -> users: [ 'testauthor' ]
After setPartnerVoteWeight(40) -> weight: 40
```

- [ ] **Step 8: Clean up the scratch files**

```bash
rm -f verify-task1.ts
rm -rf tmp-verify-data
git status
```

Confirm `git status` no longer shows `verify-task1.ts` or `tmp-verify-data/`.

- [ ] **Step 9: Commit**

```bash
git add src/data-files.ts src/partners.ts src/users.ts seed-data/partners.json seed-data/partner-vote-weight.txt .env.example
git commit -m "Add partner whitelist data module (list_parceiros)"
```

---

### Task 2: Discord commands for `list_parceiros`

**Files:**
- Modify: `src/index.ts:6` (imports)
- Modify: `src/index.ts:684-691` (ready handler — seed call)
- Modify: `src/index.ts:772` (staff permission gate)
- Modify: `src/index.ts:778-840` (`!help` text)
- Modify: `src/index.ts:959-967` (insert new command handlers between `!autolist` and `!ban`)

**Interfaces:**
- Consumes: `getPartnerUsers`, `savePartnerUsers`, `getPartnerVoteWeight`, `setPartnerVoteWeight`, `seedPartnerDataFiles` from `./partners` (Task 1)
- Produces: no new exports — this task's deliverable is the bot's runtime command behavior, consumed directly by staff in Discord.

- [ ] **Step 1: Import the partner module**

In `src/index.ts`, after line 6 (`import { getBlacklistedUsers, ... } from './users';`), add:

```typescript
import { getPartnerUsers, savePartnerUsers, getPartnerVoteWeight, setPartnerVoteWeight, seedPartnerDataFiles } from './partners';
```

- [ ] **Step 2: Seed the partner files on startup**

Replace:

```typescript
discordClient.once('ready', async () => {
  console.log(`Logged in as ${discordClient.user?.tag}!`);
  await seedDataFiles();
  const channelId = process.env.DISCORD_CHANNEL_ID; // Get channel ID from environment variable
  activeChannel = await getActiveChannel(channelId);
  await streamBlockchain();
  //streamBlockchain();
});
```

with:

```typescript
discordClient.once('ready', async () => {
  console.log(`Logged in as ${discordClient.user?.tag}!`);
  await seedDataFiles();
  await seedPartnerDataFiles();
  const channelId = process.env.DISCORD_CHANNEL_ID; // Get channel ID from environment variable
  activeChannel = await getActiveChannel(channelId);
  await streamBlockchain();
  //streamBlockchain();
});
```

- [ ] **Step 3: Gate the new commands to staff**

Replace:

```typescript
  if (!isStaff && (message.content === '!help' || message.content.startsWith('!staff') || message.content.startsWith('!unstaff') || message.content.startsWith('!stafflist') || message.content.startsWith('!ban') || message.content.startsWith('!unban') || message.content.startsWith('!importban') || message.content.startsWith('!blacklist') || message.content.startsWith('!verified') || message.content.startsWith('!verify') || message.content.startsWith('!unverify') || message.content.startsWith('!start') || message.content.startsWith('!stop'))) {
```

with:

```typescript
  if (!isStaff && (message.content === '!help' || message.content.startsWith('!staff') || message.content.startsWith('!unstaff') || message.content.startsWith('!stafflist') || message.content.startsWith('!ban') || message.content.startsWith('!unban') || message.content.startsWith('!importban') || message.content.startsWith('!blacklist') || message.content.startsWith('!verified') || message.content.startsWith('!verify') || message.content.startsWith('!unverify') || message.content.startsWith('!start') || message.content.startsWith('!stop') || message.content.startsWith('!add ') || message.content.startsWith('!remove ') || message.content.startsWith('!setvalue ') || message.content.startsWith('!list '))) {
```

- [ ] **Step 4: Add the command handlers**

Replace:

```typescript
  } else if (message.content === '!autolist') {
    const users = await getAutoUsers();
    if (users.length > 0) {
      const userList = users.sort().map(user => `- @${user}`).join('\n');
      message.channel.send(`\`\`\`**Auto Vote Users:**\n${userList}\`\`\``);
    } else {
      message.channel.send('```\nNo users are currently verified.\n```');
    }
  } else if (message.content.startsWith('!ban ')) {
```

with:

```typescript
  } else if (message.content === '!autolist') {
    const users = await getAutoUsers();
    if (users.length > 0) {
      const userList = users.sort().map(user => `- @${user}`).join('\n');
      message.channel.send(`\`\`\`**Auto Vote Users:**\n${userList}\`\`\``);
    } else {
      message.channel.send('```\nNo users are currently verified.\n```');
    }
  } else if (message.content.startsWith('!add ')) {
    const args = message.content.split(' ');
    const listName = args[1];
    const nick = args[2];

    if (listName !== 'list_parceiros') {
      message.channel.send('```\nLista desconhecida. Uso: !add list_parceiros <usuario>\n```');
      return;
    }
    if (!nick) {
      message.channel.send('```\nPor favor especifique o usuario. Uso: !add list_parceiros <usuario>\n```');
      return;
    }

    const partners = await getPartnerUsers();
    if (!partners.includes(nick)) {
      partners.push(nick);
      await savePartnerUsers(partners);
      message.channel.send(`\`\`\`Usuario @${nick} adicionado a list_parceiros.\`\`\``);
    } else {
      message.channel.send(`\`\`\`Usuario @${nick} ja esta na list_parceiros.\`\`\``);
    }
  } else if (message.content.startsWith('!remove ')) {
    const args = message.content.split(' ');
    const listName = args[1];
    const nick = args[2];

    if (listName !== 'list_parceiros') {
      message.channel.send('```\nLista desconhecida. Uso: !remove list_parceiros <usuario>\n```');
      return;
    }
    if (!nick) {
      message.channel.send('```\nPor favor especifique o usuario. Uso: !remove list_parceiros <usuario>\n```');
      return;
    }

    let partners = await getPartnerUsers();
    if (partners.includes(nick)) {
      partners = partners.filter(user => user !== nick);
      await savePartnerUsers(partners);
      message.channel.send(`\`\`\`Usuario @${nick} removido da list_parceiros.\`\`\``);
    } else {
      message.channel.send(`\`\`\`Usuario @${nick} nao esta na list_parceiros.\`\`\``);
    }
  } else if (message.content.startsWith('!setvalue ')) {
    const args = message.content.split(' ');
    const listName = args[1];
    const rawValue = args[2];

    if (listName !== 'list_parceiros') {
      message.channel.send('```\nLista desconhecida. Uso: !setvalue list_parceiros <valor>\n```');
      return;
    }

    const value = Number(rawValue);
    if (rawValue === undefined || Number.isNaN(value) || value < 0 || value > 100) {
      message.channel.send('```\nValor invalido. Uso: !setvalue list_parceiros <valor entre 0 e 100>\n```');
      return;
    }

    await setPartnerVoteWeight(value);
    message.channel.send(`\`\`\`Peso de voto da list_parceiros definido para ${value}%.\`\`\``);
  } else if (message.content.startsWith('!list ')) {
    const args = message.content.split(' ');
    const listName = args[1];

    if (listName !== 'list_parceiros') {
      message.channel.send('```\nLista desconhecida. Uso: !list list_parceiros\n```');
      return;
    }

    const partners = await getPartnerUsers();
    const weight = await getPartnerVoteWeight();
    if (partners.length > 0) {
      const userList = partners.sort().map(user => `- @${user}`).join('\n');
      message.channel.send(`\`\`\`**list_parceiros (peso atual: ${weight}%):**\n${userList}\`\`\``);
    } else {
      message.channel.send(`\`\`\`list_parceiros esta vazia (peso atual: ${weight}%).\`\`\``);
    }
  } else if (message.content.startsWith('!ban ')) {
```

- [ ] **Step 5: Document the commands in `!help`**

Replace:

```typescript
17. !vote <username>/<permlink> <votevalue>
   - Make a manual vote overwriting user score

\`\`\`
    `;
```

with:

```typescript
17. !vote <username>/<permlink> <votevalue>
   - Make a manual vote overwriting user score

18. !add list_parceiros <username>
   - Adds a user to the partner whitelist (list_parceiros)

19. !remove list_parceiros <username>
   - Removes a user from the partner whitelist (list_parceiros)

20. !setvalue list_parceiros <value>
   - Sets the fixed vote weight (0-100) used for every post from list_parceiros

21. !list list_parceiros
   - Lists users currently in list_parceiros and the current vote weight

\`\`\`
    `;
```

- [ ] **Step 6: Manual verification**

No test framework exists in this repo, so this is verified by actually running the bot against a Discord test server (use `DISCORD_TOKEN`/`DISCORD_CHANNEL_ID` from a test bot/channel, not production, while iterating).

Run: `pnpm dev`

In the Discord test channel, as a staff-listed account, run each of these in order and confirm the shown response:

| Command | Expected response |
|---|---|
| `!add list_parceiros testauthor` | `Usuario @testauthor adicionado a list_parceiros.` |
| `!add list_parceiros testauthor` | `Usuario @testauthor ja esta na list_parceiros.` |
| `!list list_parceiros` | Shows `testauthor` and `peso atual: 50%` |
| `!setvalue list_parceiros abc` | `Valor invalido...` |
| `!setvalue list_parceiros 40` | `Peso de voto da list_parceiros definido para 40%.` |
| `!list list_parceiros` | Shows `peso atual: 40%` |
| `!remove list_parceiros testauthor` | `Usuario @testauthor removido da list_parceiros.` |
| `!list list_parceiros` | `list_parceiros esta vazia (peso atual: 40%).` |
| `!help` | Output includes new items 18-21 |

Then, from a Discord account that is **not** in `staff.json`, run `!add list_parceiros x` and confirm the response is the standard `You do not have permission to perform this action.` message.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts
git commit -m "Add staff commands to manage list_parceiros"
```

---

### Task 3: Blockchain detection + partner post embed

**Files:**
- Modify: `src/index.ts:586-623` (insert `processPartnerPost`, update `processBlock`)

**Interfaces:**
- Consumes: `getPartnerUsers`, `getPartnerVoteWeight` from `./partners` (Task 1); existing `getBlacklistedUsers`, `checkHivewatchers`, `getPostInfo`, `getSameDayPostInfo`, `getActiveChannel` (already in `src/index.ts`, unchanged)
- Produces: `processPartnerPost(post: any, timestamp: string): Promise<null | void>` (module-private, mirrors `processPost`), updated `processBlock` behavior consumed only by the block stream itself.

- [ ] **Step 1: Add `processPartnerPost`**

In `src/index.ts`, replace:

```typescript
  return null;
};

async function processBlock(block: any): Promise<void> {
```

with (this closes `processPost`, inserts the new function, then starts `processBlock` exactly as before):

```typescript
// Parallel to processPost, but for authors on the partner whitelist
// (list_parceiros) instead of the hivebr/hive-br tag. Skips the
// community scoring engine entirely and uses a fixed, staff-configured
// vote weight instead.
const processPartnerPost = async (post: any, timestamp: string) => {
  const { author, permlink } = post;
  const postLnk = `https://peakd.com/@${author}/${permlink}`;

  const blacklistedUsers = await getBlacklistedUsers();
  if (blacklistedUsers.includes(author)) {
    console.error(`Skipping partner post <${postLnk}> by blacklisted user @${author}`);
    return;
  }

  const hivewatchersList = await checkHivewatchers();
  if (hivewatchersList.includes(author)) {
    console.error(`Skipping partner post <${postLnk}> by user @${author} flagged by Hivewatchers.`);
    const channel = await getActiveChannel();
    if (channel) {
      await channel.send(`Skipping post <${postLnk}> by @${author}: User is flagged by Hivewatchers.`);
    }
    return;
  }

  const postInfo = await getPostInfo(author, permlink);
  if (!postInfo) {
    console.error(`Failed to fetch partner post info for @${author}/${permlink}`);
    return;
  }

  const postCreatedTime = new Date(postInfo.created).getTime();
  const providedTimestamp = new Date(timestamp).getTime();
  if (providedTimestamp < postCreatedTime || providedTimestamp > postCreatedTime + 6000) {
    console.log(`Partner post @${author}/${permlink} was created outside the allowed timestamp range. Skipping.`);
    return;
  }

  const referenceDate = new Date(timestamp + 'Z');
  const { alreadyVotedToday } = await getSameDayPostInfo(author, permlink, referenceDate);
  if (alreadyVotedToday) {
    console.error(`Skipping partner post <${postLnk}> by @${author} because they were already voted on the same day.`);
    const channel = await getActiveChannel();
    if (channel) {
      await channel.send(`Skipping post <${postLnk}> by @${author}: Already voted on the same day.`);
    }
    return;
  }

  const { title, body } = postInfo;
  const voteValue = await getPartnerVoteWeight();
  const postLink = `https://peakd.com/@${author}/${permlink}`;

  let thumbnailUrl: string | null = null;
  const imageRegex = /!\[.*?\]\((.*?)\)/;
  const match = body.match(imageRegex);
  if (match && match[1]) {
    thumbnailUrl = match[1];
  }

  const safeTitle = title || 'Untitled';

  const embed = new EmbedBuilder()
    .setColor(0x9b59b6) // Purple: visually distinct from the community-post blue (0x0099ff)
    .setAuthor({ name: `@${author}`, iconURL: `https://images.hive.blog/u/${author}/avatar`, url: `https://peakd.com/@${author}` })
    .setTitle(`**${safeTitle}**`)
    .setURL(postLink);

  if (thumbnailUrl) {
    embed.setThumbnail(thumbnailUrl);
  }

  embed.addFields(
    { name: '**🤝 Post de Parceria**', value: `Voto fixo: ${voteValue}%`, inline: false },
  );

  const channel = await getActiveChannel();

  const voteButton = new ButtonBuilder()
    .setCustomId(`${author}/${permlink}/${voteValue}`)
    .setLabel(' 🚀 VOTE! ')
    .setStyle(ButtonStyle.Primary);

  const viewPostButton = new ButtonBuilder()
    .setLabel('View Post')
    .setStyle(ButtonStyle.Link)
    .setURL(postLink);

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(voteButton, viewPostButton);
  if (channel) await channel.send({ embeds: [embed], components: [buttons] });

  return null;
};

async function processBlock(block: any): Promise<void> {
```

Note this reproduces the `async function processBlock` line verbatim so the file ends up identical to before except for the inserted function — Step 2 below replaces the body of `processBlock` starting from that same line.

- [ ] **Step 2: Branch `processBlock` on tag vs. whitelist**

Replace:

```typescript
async function processBlock(block: any): Promise<void> {
  let blockNum = 0;

  for (const transaction of block.transactions) {
    blockNum = transaction.block_num;

    const commentOp = transaction.operations.find(
      (op: any) => op[0] === 'comment' && op[1].parent_author === ''
    );

    if (commentOp) {
      const postData = commentOp[1];
      const { json_metadata, author } = postData;

      try {
        const metadata = JSON.parse(json_metadata);
        if (
          Array.isArray(metadata.tags) &&
          (metadata.tags as string[]).map((tag) => tag.toLowerCase()).some(tag => tag === 'hivebr' || tag === 'hive-br')
        ) {
            const result = await processPost(postData, block.timestamp);

            // if (result && activeChannel) {
            //   const { embed, buttons } = result;
            //   await activeChannel.send({ embeds: [embed], components: [buttons] });
            // }
        }
      } catch (error) {
        console.error('Error parsing json_metadata or checking tags:', error);
      }
    }
  }

  //console.log(`Block ${blockNum} processed.`);
  await updateLastProcessedBlock(process.env.BLOCK_FILE || '', blockNum);
}
```

with:

```typescript
async function processBlock(block: any): Promise<void> {
  let blockNum = 0;

  for (const transaction of block.transactions) {
    blockNum = transaction.block_num;

    const commentOp = transaction.operations.find(
      (op: any) => op[0] === 'comment' && op[1].parent_author === ''
    );

    if (commentOp) {
      const postData = commentOp[1];
      const { json_metadata, author } = postData;

      let hasHiveBrTag = false;
      try {
        const metadata = JSON.parse(json_metadata);
        hasHiveBrTag =
          Array.isArray(metadata.tags) &&
          (metadata.tags as string[]).map((tag) => tag.toLowerCase()).some(tag => tag === 'hivebr' || tag === 'hive-br');
      } catch (error) {
        console.error('Error parsing json_metadata or checking tags:', error);
      }

      if (hasHiveBrTag) {
        await processPost(postData, block.timestamp);
      } else {
        const partnerUsers = await getPartnerUsers();
        if (partnerUsers.includes(author)) {
          await processPartnerPost(postData, block.timestamp);
        }
      }
    }
  }

  //console.log(`Block ${blockNum} processed.`);
  await updateLastProcessedBlock(process.env.BLOCK_FILE || '', blockNum);
}
```

- [ ] **Step 3: Manual end-to-end verification**

⚠️ This task causes the bot to broadcast **real Hive blockchain vote transactions** the moment someone clicks "🚀 VOTE!" on a partner embed. Before doing this verification, confirm `.env` points `HIVE_ACCOUNT`/`HIVE_PRIVATE_KEY` at a disposable/low-stake test account (not the production `hive-br.voter` account) and `DISCORD_CHANNEL_ID` at a test channel — same test setup as Task 2.

1. Run `pnpm dev`.
2. In the test Discord channel, run `!start`.
3. Run `!add list_parceiros <a Hive username you control>`.
4. From that Hive account, publish a normal top-level post **without** the `hivebr`/`hive-br` tag.
5. Within roughly 10-30 seconds (Hive produces a block every 3s), confirm the bot posts an embed with:
   - A purple-colored border (distinct from the blue community embed)
   - The post's title, author, and thumbnail (if the post has an image)
   - A "**🤝 Post de Parceria**" field showing "Voto fixo: 50%" (or whatever `!setvalue list_parceiros` was last set to)
   - "🚀 VOTE!" and "View Post" buttons
6. Click "🚀 VOTE!" and confirm the button becomes disabled and reads "Voted by @<your Discord display name>", then confirm on peakd.com that the vote landed on the post.
7. Confirm the negative case: have a Hive account **not** in `list_parceiros` publish a post without the `hivebr` tag — confirm nothing is posted to the Discord channel.
8. Code-review confirm the tag-priority rule: in the `processBlock` diff from Step 2, `hasHiveBrTag` is checked before the whitelist lookup, so an author who is in `list_parceiros` but tags a post `hivebr` runs `processPost` (the full scoring embed), not `processPartnerPost`. (No live post needed for this check — it's directly visible in the `if/else` added in Step 2.)

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "Detect and vote on list_parceiros posts directly from the blockchain"
```
