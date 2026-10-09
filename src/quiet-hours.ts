// Optional nightly downtime to cut Railway compute costs. Railway bills
// memory for as long as the process is alive, so pausing the block stream
// isn't enough: during the quiet window the process exits completely, and a
// Railway cron schedule boots it again when the window ends. On boot the
// stream resumes from BLOCK_FILE, so posts published overnight are still
// processed — just later.
//
// QUIET_HOURS="01-09" means 01:00 to 09:00 Brasília time. Unset = always on.

// Brasília has had no daylight saving time since 2019.
const BRASILIA_UTC_OFFSET_HOURS = -3;
const HOUR_MS = 60 * 60 * 1000;

export type QuietWindow = { startHour: number; endHour: number };

export function parseQuietHours(value: string | undefined): QuietWindow | null {
  if (!value) return null;

  const match = value.trim().match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    console.error(`Ignoring invalid QUIET_HOURS "${value}". Expected format: "01-09".`);
    return null;
  }

  const startHour = Number(match[1]);
  const endHour = Number(match[2]);
  if (startHour > 23 || endHour > 23 || startHour === endHour) {
    console.error(`Ignoring invalid QUIET_HOURS "${value}". Hours must be 0-23 and different.`);
    return null;
  }

  return { startHour, endHour };
}

function brasiliaHour(now: Date): number {
  return (now.getUTCHours() + 24 + BRASILIA_UTC_OFFSET_HOURS) % 24;
}

// The window may wrap past midnight (e.g. "22-06").
export function isQuietTime(window: QuietWindow, now = new Date()): boolean {
  const hour = brasiliaHour(now);
  if (window.startHour < window.endHour) {
    return hour >= window.startHour && hour < window.endHour;
  }
  return hour >= window.startHour || hour < window.endHour;
}

export function msUntilQuietStart(window: QuietWindow, now = new Date()): number {
  const hoursAhead = (window.startHour - brasiliaHour(now) + 24) % 24 || 24;
  const startOfCurrentHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  return startOfCurrentHour + hoursAhead * HOUR_MS - now.getTime();
}

// Railway cron schedules are in UTC.
export function cronScheduleForWakeUp(window: QuietWindow): string {
  const utcHour = (window.endHour - BRASILIA_UTC_OFFSET_HOURS) % 24;
  return `0 ${utcHour} * * *`;
}
