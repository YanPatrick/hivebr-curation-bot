export type StoppableStream = {
  removeAllListeners(): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  destroy(): unknown;
};

// Stops a dhive block stream for real. dhive wraps its block iterator in a
// PassThrough that is already flowing, and removing the 'data' listeners
// does not pause a flowing stream: the iterator would keep fetching a block
// every 3s in the background, forever. Destroying the stream makes dhive's
// next write fail, which parks the iterator.
//
// A get_block request may still be in flight. If it fails, dhive calls
// stream.emit('error') directly, and an 'error' with no listener throws and
// crashes the process, so a no-op listener stays attached.
export function stopStream(stream: StoppableStream | null | undefined): void {
  if (!stream) return;
  stream.removeAllListeners();
  stream.on('error', () => {});
  stream.destroy();
}
