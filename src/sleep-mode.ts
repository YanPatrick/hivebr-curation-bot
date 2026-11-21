import * as http from 'http';
import { AddressInfo } from 'net';
import { QuietWindow, isQuietTime, msUntilQuietEnd } from './quiet-hours';

// Night sleep for Railway Serverless. While sleeping the bot sends no network
// traffic at all, so Railway puts the service to sleep and stops billing it.
// A small waker service (Railway cron + curl) hits this HTTP server at the
// end of the window. Railway then boots the process again (cold boot). If
// the process is somehow still alive when the window ends, a request or the
// safeguard timer calls onWake, which exits so Railway restarts it fresh.

export type SleepController = {
  readonly port: number;
  isSleeping(): boolean;
  sleep(): void;
  close(): Promise<void>;
};

export function startSleepController(opts: {
  window: QuietWindow;
  port: number;
  onWake: () => void;
  host?: string;
  now?: () => Date;
}): Promise<SleepController> {
  const { window, onWake } = opts;
  const now = opts.now ?? (() => new Date());
  let sleeping = false;
  let woke = false;
  let safeguard: NodeJS.Timeout | null = null;

  const wake = () => {
    if (woke) return;
    woke = true;
    onWake();
  };

  const server = http.createServer((_req, res) => {
    let body = 'acordado';
    let wakeAfterResponse = false;
    if (sleeping) {
      if (isQuietTime(window, now())) {
        body = `dormindo até ${String(window.endHour).padStart(2, '0')}h`;
      } else {
        body = 'acordando';
        wakeAfterResponse = true;
      }
    }
    if (wakeAfterResponse) res.on('finish', wake);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(body);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host ?? '::', () => {
      server.off('error', reject);
      resolve({
        port: (server.address() as AddressInfo).port,
        isSleeping: () => sleeping,
        sleep() {
          if (sleeping) return;
          sleeping = true;
          safeguard = setTimeout(wake, msUntilQuietEnd(window, now()));
        },
        close() {
          if (safeguard) clearTimeout(safeguard);
          server.closeAllConnections();
          return new Promise<void>((done) => server.close(() => done()));
        },
      });
    });
  });
}
