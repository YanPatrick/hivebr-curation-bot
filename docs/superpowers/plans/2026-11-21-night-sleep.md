# Night Sleep Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Between 02h and 09h (Brasília) the bot goes fully silent so Railway Serverless sleeps it and stops billing RAM. A tiny Railway cron service wakes it with an HTTP request at 09h.

**Architecture:** A new `sleep-mode` module owns a minimal `http` server and the awake/sleeping state. `index.ts` puts the bot to sleep at the start of the window: it stops the block stream for real, destroys the Discord client, and enters silence. Waking up is always `process.exit(0)` followed by a Railway restart (`restartPolicyType: ALWAYS`), or a cold boot from Railway sleep. Two temporary diagnostics (memory every 30 min, volume contents at boot) feed the next cost decision.

**Tech Stack:** TypeScript (commonjs), Node built-ins (`http`, `fs`, `node:test`), discord.js v14, @hiveio/dhive 1.3.6. Tests run through `node --test` with the already-installed `ts-node/register`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-21-night-sleep-design.md`

## Global Constraints

- `QUIET_HOURS` keeps its existing format (`"02-09"`, Brasília time, UTC-3, no DST). Unset = today's behavior exactly: no HTTP server, no sleep.
- While sleeping the process makes **no outbound network traffic**: no Discord, no block stream, no periodic logs.
- HTTP server: built-in `http`, port `Number(process.env.PORT) || 8080`, host `'::'`, started only when `QUIET_HOURS` is valid. No public domain.
- HTTP response bodies (exact, plain text, status 200): `acordado`, `dormindo até HHh` (two-digit end hour, e.g. `dormindo até 09h`), `acordando`.
- Waking always means `process.exit(0)`; `railway.json` sets `"restartPolicyType": "ALWAYS"`.
- Memory log interval: 30 minutes. Line format: `Memória: rss=150MB heapUsed=25MB heapTotal=30MB external=5MB` (MB = bytes / 1048576, rounded).
- Volume diagnostic runs once per boot, only when `DATA_DIR` is set, and never throws.
- User-facing strings are Portuguese. Code, comments and identifiers are English.
- Do not push. Pushing to `main` deploys to Railway, so the user decides when.

## Review Focus

1. **An in-flight `get_block` rejects after the stream was stopped.** dhive calls `stream.emit('error')` directly. With no listener left, that throws and crashes the process. `stopStream` must leave a no-op `'error'` listener (test in Task 2).
2. **Boot inside the window must not call `discordClient.login` or start the stream.** Either one would keep traffic flowing and Railway would never sleep the bot (smoke step in Task 5).
3. **The safeguard timer and an HTTP request both fire at the end of the window.** `onWake` must run exactly once (test in Task 3).
4. **A stream reconnect is already pending when `goToSleep` starts.** The `'error'`/`'end'` handlers wait 5 s and then call `streamBlockchain()`. If that lands after sleep began, a new stream polls all night and Railway never sleeps the bot. `streamBlockchain` must return immediately once sleep has begun (guard in Task 5, Step 2; check it in code review).
5. **`DATA_DIR` is missing or unreadable, or `fs.promises.statfs` doesn't exist** (older Node on Railway). `logVolumeUsage` logs the problem and resolves (test in Task 4).

---

### Task 1: Test runner + `msUntilQuietEnd`

**Files:**
- Modify: `package.json` (scripts)
- Modify: `tsconfig.json` (add `exclude`)
- Modify: `src/quiet-hours.ts`
- Test: `src/quiet-hours.test.ts`

**Interfaces:**
- Consumes: existing `parseQuietHours`, `isQuietTime`, `msUntilQuietStart`, `QuietWindow` from `src/quiet-hours.ts`.
- Produces: `msUntilQuietEnd(window: QuietWindow, now?: Date): number`, which returns ms until the next `endHour:00` in Brasília time, always > 0. Also `npm test`.

- [ ] **Step 1: Add the test script and keep tests out of the build**

`package.json` scripts: `"test": "node --test --require ts-node/register \"src/**/*.test.ts\""`.
`tsconfig.json`: add top-level `"exclude": ["node_modules", "dist", "src/**/*.test.ts"]`.

- [ ] **Step 2: Write `src/quiet-hours.test.ts`** (`node:test` + `node:assert/strict`). Window `W = parseQuietHours('02-09')`:

```ts
test('parses 02-09', () => assert.deepEqual(W, { startHour: 2, endHour: 9 }));
test('rejects bad values', () => { assert.equal(parseQuietHours('2-2'), null); assert.equal(parseQuietHours('x'), null); assert.equal(parseQuietHours(undefined), null); });
test('02:00 BRT is quiet', () => assert.equal(isQuietTime(W, new Date('2026-11-21T05:00:00Z')), true));
test('01:59 BRT is not quiet', () => assert.equal(isQuietTime(W, new Date('2026-11-21T04:59:00Z')), false));
test('09:00 BRT is not quiet', () => assert.equal(isQuietTime(W, new Date('2026-11-21T12:00:00Z')), false));
test('wrapping window 22-06', () => { const w = parseQuietHours('22-06')!; assert.equal(isQuietTime(w, new Date('2026-11-21T01:00:00Z')), true); assert.equal(isQuietTime(w, new Date('2026-11-21T09:00:00Z')), false); });
test('msUntilQuietStart from 09:00 BRT is 17h', () => assert.equal(msUntilQuietStart(W, new Date('2026-11-21T12:00:00Z')), 17 * 3600_000));
test('msUntilQuietEnd from 02:00 BRT is 7h', () => assert.equal(msUntilQuietEnd(W, new Date('2026-11-21T05:00:00Z')), 7 * 3600_000));
test('msUntilQuietEnd from 08:59:30 BRT is 30s', () => assert.equal(msUntilQuietEnd(W, new Date('2026-11-21T11:59:30Z')), 30_000));
```

- [ ] **Step 3: Run `npm test`.** Expected: FAIL, `msUntilQuietEnd` is not exported.

- [ ] **Step 4: Implement `msUntilQuietEnd` in `src/quiet-hours.ts`.** Extract the body of `msUntilQuietStart` into a private `msUntilBrasiliaHour(hour: number, now: Date): number` and call it from both functions. Leave `cronScheduleForWakeUp` alone for now; Task 5 removes it.

- [ ] **Step 5: Run `npm test` and `npm run build`.** Expected: all tests pass, build clean, no `dist/*.test.js`.

- [ ] **Step 6: Commit** `feat: add test runner and msUntilQuietEnd`

---

### Task 2: Stop the block stream for real

**Files:**
- Create: `src/hive/stream.ts`
- Test: `src/hive/stream.test.ts`

**Interfaces:**
- Produces: `stopStream(stream: StoppableStream | null | undefined): void`, with `type StoppableStream = { removeAllListeners(): unknown; on(event: 'error', fn: (err: Error) => void): unknown; destroy(): unknown }`. It removes all listeners, attaches a no-op `'error'` listener, then destroys the stream.

- [ ] **Step 1: Write `src/hive/stream.test.ts`.** Build streams with `iteratorStream` from `@hiveio/dhive/lib/utils`, which is the same wrapper `getBlockStream` uses. The source is an infinite async generator that increments `pulls` and yields `{}` after a 10 ms delay. Attach `on('data', () => {})`, wait 100 ms, then:

```ts
test('removeAllListeners alone keeps polling (documents the bug)', ...)   // after removeAllListeners: wait 150ms, assert pulls > before + 5
test('stopStream stops polling', ...)                                      // after stopStream: wait 150ms, assert pulls <= before + 1
test('stopStream survives a late error emit', ...)                         // after stopStream: assert.doesNotThrow(() => s.emit('error', new Error('late')))
test('stopStream accepts null', () => assert.doesNotThrow(() => stopStream(null)));
```

- [ ] **Step 2: Run `npm test`.** Expected: the three `stopStream` tests fail (module missing). The "documents the bug" test passes.

- [ ] **Step 3: Implement `stopStream` in `src/hive/stream.ts`** as described in Interfaces. Add a comment saying why `removeAllListeners` isn't enough: a flowing `PassThrough` doesn't pause when its `'data'` listeners are removed.

- [ ] **Step 4: Run `npm test`.** Expected: all pass.

- [ ] **Step 5: Commit** `fix: add stopStream that actually stops dhive block polling`

---

### Task 3: Sleep controller with wake-up HTTP server

**Files:**
- Create: `src/sleep-mode.ts`
- Test: `src/sleep-mode.test.ts`

**Interfaces:**
- Consumes: `QuietWindow`, `isQuietTime`, `msUntilQuietEnd` (Task 1).
- Produces:

```ts
export type SleepController = {
  readonly port: number;      // actual listening port (tests pass port 0)
  isSleeping(): boolean;
  sleep(): void;              // enter silence + arm safeguard timer for msUntilQuietEnd(window, now())
  close(): Promise<void>;     // stop server and timer (tests only)
};
export function startSleepController(opts: {
  window: QuietWindow;
  port: number;
  onWake: () => void;         // called at most once per controller
  host?: string;              // default '::'
  now?: () => Date;           // default () => new Date()
}): Promise<SleepController>; // resolves once listening
```

HTTP, any method or path, status 200, plain text:
- not sleeping → `acordado`
- sleeping and `isQuietTime` → `dormindo até HHh`
- sleeping and not quiet → `acordando`, then call `onWake` on the response's `'finish'` event

- [ ] **Step 1: Write `src/sleep-mode.test.ts`.** Use `host: '127.0.0.1'`, `port: 0`, `W = parseQuietHours('02-09')!`, and fetch with the global `fetch`. Call `close()` in `finally`.

```ts
test('awake answers acordado and never wakes', ...)                    // body === 'acordado', wakes === 0
test('sleeping at 03:00 BRT answers dormindo até 09h', ...)            // now = 2026-11-21T06:00:00Z; sleep(); body === 'dormindo até 09h', wakes === 0
test('sleeping at 09:05 BRT answers acordando and wakes once', ...)    // now = 2026-11-21T12:05:00Z; sleep(); two requests; bodies 'acordando'; wakes === 1
test('safeguard timer wakes at window end', ...)                       // now = 2026-11-21T11:59:59.900Z (fixed); sleep(); wait 400ms; wakes === 1
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement `startSleepController` in `src/sleep-mode.ts`.** Keep a `woke` flag so `onWake` runs at most once. `sleep()` is idempotent and arms one timer. `close()` clears the timer and closes the server.

- [ ] **Step 4: Run `npm test`.** Expected: all pass.

- [ ] **Step 5: Commit** `feat: add sleep controller with wake-up HTTP server`

---

### Task 4: Memory and volume diagnostics

**Files:**
- Create: `src/diagnostics.ts`
- Test: `src/diagnostics.test.ts`

**Interfaces:**
- Produces:

```ts
export function formatMemoryUsage(m: NodeJS.MemoryUsage): string;
export function startMemoryLog(intervalMs: number, log?: (line: string) => void): () => void; // logs now + every interval; returns stop
export function directorySizes(dir: string): Promise<{ name: string; bytes: number }[]>;     // direct children, dirs summed recursively, sorted desc
export function logVolumeUsage(dir: string, log?: (line: string) => void): Promise<void>;    // never rejects
```

`logVolumeUsage` output: one line `Volume <dir>: usado <X> MB de <Y> MB` from `fs.promises.statfs` (skip this line if `statfs` is undefined). Then one line per child, `  <name>: <size>`, at most 10, where size is shown in KB below 1 MB and in MB otherwise. On any error, log `Não foi possível analisar o volume <dir>: <message>`.

- [ ] **Step 1: Write `src/diagnostics.test.ts`:**

```ts
test('formatMemoryUsage', () => assert.equal(formatMemoryUsage({ rss: 150 * MB, heapUsed: 25 * MB, heapTotal: 30 * MB, external: 5 * MB, arrayBuffers: 0 }), 'Memória: rss=150MB heapUsed=25MB heapTotal=30MB external=5MB'));
test('directorySizes sums subdirectories', ...)   // temp dir: a (1000 B), sub/b (3000 B), sub/c (2000 B) → [{ name: 'sub', bytes: 5000 }, { name: 'a', bytes: 1000 }]
test('logVolumeUsage on missing dir resolves and logs', ...) // collects lines; resolves; some line starts with 'Não foi possível analisar o volume'
test('startMemoryLog logs immediately and stops', ...)       // stop = startMemoryLog(10_000, push); lines.length === 1; stop()
```

- [ ] **Step 2: Run `npm test`.** Expected: FAIL (module missing).

- [ ] **Step 3: Implement `src/diagnostics.ts`.** Top-of-file comment: these diagnostics are temporary and exist to decide the next cost cut (spec, "Diagnósticos").

- [ ] **Step 4: Run `npm test`.** Expected: all pass.

- [ ] **Step 5: Commit** `feat: add temporary memory and volume diagnostics`

---

### Task 5: Wire sleep mode into the bot; remove the cron mode

**Files:**
- Modify: `src/index.ts` (imports at line 13; `streamBlockchain` at 776-778; `shutdownForQuietHours` at 829-859; `ready` handler at 872-886; `!stop` at 1346-1354; boot at 1462-1470)
- Modify: `src/quiet-hours.ts` (delete `cronScheduleForWakeUp` and the file-top comment about the Railway cron)
- Modify: `railway.json`
- Modify: `.env.example` (`QUIET_HOURS` block)

**Interfaces:**
- Consumes: `stopStream` (Task 2), `startSleepController` / `SleepController` (Task 3), `startMemoryLog` / `logVolumeUsage` (Task 4), `isQuietTime` / `msUntilQuietStart` (Task 1).

- [ ] **Step 1: Use `stopStream`** at all three places that now call `stream.removeAllListeners()`: `streamBlockchain` re-entry, `!stop` and the quiet shutdown. Each becomes `stopStream(stream); stream = null;`.

- [ ] **Step 2: Replace `shutdownForQuietHours` with `goToSleep(): Promise<void>`.** It does the following, in order:
  1. Set a module-level `let goingToSleep = false` flag to `true`. Also add a first line to `streamBlockchain`: `if (goingToSleep) return;` (Review Focus #4).
  2. `stopStream`.
  3. The existing in-flight wait (`QUIET_SHUTDOWN_GRACE_MS`, unchanged).
  4. Discord notice: `Modo noturno: bot dormindo até HHh. Posts publicados nesse período serão processados quando ele acordar.`
  5. Stop the memory log.
  6. `await discordClient.destroy()`.
  7. `sleepController!.sleep()`.
  8. Log `Dormindo: sem tráfego de rede até o despertador.`

  No `process.exit`.

- [ ] **Step 3: In the `ready` handler,** start the memory log (`startMemoryLog(30 * 60 * 1000)`, keep its stop function in a module-level variable). Keep the existing `setTimeout(goToSleep, msUntilQuietStart(quietWindow))`.

- [ ] **Step 4: Replace the boot block at the bottom with `async function boot(): Promise<void>`:**
  1. If `DATA_DIR` is set, `await logVolumeUsage(process.env.DATA_DIR)`.
  2. If `quietWindow`, start the sleep controller with `onWake` set to: log `Fim da janela de sono: reiniciando o bot.` then `process.exit(0)`.
  3. If it is quiet time, log `Boot dentro da janela de sono (QUIET_HOURS=…): dormindo sem conectar ao Discord.`, call `sleep()` and return.
  4. Otherwise `discordClient.login(...)`.

  Call `boot()` at module end with a `.catch` that logs and calls `process.exit(1)`.

- [ ] **Step 5: Delete `cronScheduleForWakeUp`** and its import. Update the comment at the top of `quiet-hours.ts`: the process now sleeps through Railway Serverless and an HTTP waker, not a cron restart.

- [ ] **Step 6: Update `railway.json`** to `"deploy": { "startCommand": "node dist/index.js", "restartPolicyType": "ALWAYS" }`. Rewrite the `QUIET_HOURS` block in `.env.example` (Portuguese) to say three things:
  - `02-09` = dorme 02h–09h de Brasília.
  - Requer Serverless ativado e o serviço despertador (ver spec).
  - `PORT` opcional, padrão 8080.

  Remove the cron warning.

- [ ] **Step 7: Verify** `npm run build` (clean) and `npm test` (all pass).

- [ ] **Step 8: Smoke-test boot inside the window (Review Focus #2).** Pick a `QUIET_HOURS` window that contains the current Brasília hour. Run `QUIET_HOURS=<window> DISCORD_TOKEN= PORT=8089 node dist/index.js`, then `curl -s localhost:8089` from another shell.

  Expected:
  - the log shows the "Boot dentro da janela" line;
  - **no** Discord login error (login was never attempted);
  - curl prints `dormindo até HHh`.

  Stop the process afterwards.

- [ ] **Step 9: Commit** `feat: sleep through Railway Serverless during QUIET_HOURS instead of cron restarts`

---

### Task 6: Railway setup guide + commit docs

**Files:**
- Modify: `docs/superpowers/specs/2026-11-21-night-sleep-design.md` (section "Configuração no Railway")

- [ ] **Step 1: Expand "Configuração no Railway"** into numbered Portuguese steps, in this order:
  1. Deploy the code with `QUIET_HOURS` unset. It behaves exactly like today.
  2. In the bot service, Settings: turn on **Serverless**, remove any Cron Schedule, and note the private DNS name `<nome>.railway.internal` shown under Networking.
  3. Add variable `PORT=8080`.
  4. Create the waker service: New → Docker Image `curlimages/curl`, Cron Schedule `0,15,30 12 * * *`, start command `curl -fsS --retry 5 --retry-delay 10 --retry-all-errors --max-time 120 http://<nome>.railway.internal:8080/`.
  5. Only then set `QUIET_HOURS=02-09` on the bot.
  6. Follow the checks in "Validação depois do deploy".

- [ ] **Step 2: Commit** the spec, this plan and the guide: `docs: night sleep mode design, plan and Railway setup`.
