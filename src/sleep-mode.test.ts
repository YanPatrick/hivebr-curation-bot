import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuietHours } from './quiet-hours';
import { startSleepController } from './sleep-mode';

const W = parseQuietHours('02-09')!;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withController(nowIso: string, body: (ctl: Awaited<ReturnType<typeof startSleepController>>, wakes: () => number) => Promise<void>) {
  let wakes = 0;
  const ctl = await startSleepController({
    window: W,
    port: 0,
    host: '127.0.0.1',
    now: () => new Date(nowIso),
    onWake: () => { wakes++; },
  });
  try {
    await body(ctl, () => wakes);
  } finally {
    await ctl.close();
  }
}

const get = async (port: number) => (await fetch(`http://127.0.0.1:${port}/`)).text();

test('awake answers acordado and never wakes', () =>
  withController('2026-11-21T15:00:00Z', async (ctl, wakes) => {
    assert.equal(ctl.isSleeping(), false);
    assert.equal(await get(ctl.port), 'acordado');
    await sleep(50);
    assert.equal(wakes(), 0);
  }));

test('sleeping at 03:00 BRT answers dormindo até 09h', () =>
  withController('2026-11-21T06:00:00Z', async (ctl, wakes) => {
    ctl.sleep();
    assert.equal(ctl.isSleeping(), true);
    assert.equal(await get(ctl.port), 'dormindo até 09h');
    await sleep(50);
    assert.equal(wakes(), 0);
  }));

test('sleeping at 09:05 BRT answers acordando and wakes once', () =>
  withController('2026-11-21T12:05:00Z', async (ctl, wakes) => {
    ctl.sleep();
    assert.equal(await get(ctl.port), 'acordando');
    assert.equal(await get(ctl.port), 'acordando');
    await sleep(50);
    assert.equal(wakes(), 1);
  }));

test('safeguard timer wakes at window end', () =>
  withController('2026-11-21T11:59:59.900Z', async (ctl, wakes) => {
    ctl.sleep();
    await sleep(400);
    assert.equal(wakes(), 1);
  }));
