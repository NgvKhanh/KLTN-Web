import { runOnce } from './recurringSchedule.service';

// Vong quet lich the dinh ky: moi 5 phut kiem tra lich nao da den "nextRunAt"
// de tao the moi. Do gio hen chi chinh xac toi phut (timeOfDay "HH:mm"), quet
// moi 5 phut la du, khong can day nhu vong quet nhac han (60s).
const CHECK_INTERVAL_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

export function startRecurringScheduler(): void {
  if (timer) return;
  timer = setInterval(() => {
    runOnce().catch((err) => {
      console.error('[recurring] loi khi quet lich the dinh ky:', err);
    });
  }, CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopRecurringScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
