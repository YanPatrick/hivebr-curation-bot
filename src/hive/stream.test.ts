import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'stream';
import { iteratorStream } from '@hiveio/dhive/lib/utils';
import { stopStream } from './stream';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Same wrapper dhive's getBlockStream() uses, fed by a fake "Hive node" that
// counts how many blocks were requested.
function countingStream() {
  const counter = { pulls: 0, stopped: false };
  async function* blocks() {
    while (!counter.stopped) {
      counter.pulls++;
      await sleep(10);
      yield {};
    }
  }
  const stream = iteratorStream(blocks()) as unknown as Readable;
  stream.on('data', () => {});
  return { stream, counter };
}

test('removeAllListeners alone keeps polling (documents the bug)', async () => {
  const { stream, counter } = countingStream();
  await sleep(100);
  stream.removeAllListeners();
  const before = counter.pulls;
  await sleep(150);
  try {
    assert.ok(counter.pulls > before + 5, `expected polling to continue, pulls went ${before} -> ${counter.pulls}`);
  } finally {
    counter.stopped = true;
    stream.destroy();
  }
});

test('stopStream stops polling', async () => {
  const { stream, counter } = countingStream();
  await sleep(100);
  stopStream(stream);
  const before = counter.pulls;
  await sleep(150);
  counter.stopped = true;
  assert.ok(counter.pulls <= before + 1, `expected polling to stop, pulls went ${before} -> ${counter.pulls}`);
});

test('stopStream survives a late error emit', async () => {
  const { stream, counter } = countingStream();
  await sleep(50);
  stopStream(stream);
  counter.stopped = true;
  assert.doesNotThrow(() => stream.emit('error', new Error('late')));
});

test('stopStream accepts null', () => assert.doesNotThrow(() => stopStream(null)));
