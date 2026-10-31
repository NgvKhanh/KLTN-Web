// Vong quet canh bao nguy co tre han (RISK_MODULE.md §8.1): 30 phut / lan, lan dau 1 phut sau khi server chay (de dau tren the
// hien som sau khi khoi dong lai). Khong chay chong: vong truoc chua xong thi bo qua nhip nay.
import { runRiskScan } from './risk.service';

const CHECK_INTERVAL_MS = 30 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let first: ReturnType<typeof setTimeout> | null = null;
let running = false;

/** Xuat rieng de test / script goi truc tiep 1 vong (khong doi setInterval). */
export async function runOnce(now: Date = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const s = await runRiskScan(now);
    if (s.notifications > 0 || s.bootstrap) {
      console.log(`[risk] quet ${s.candidates} the, cham ${s.scored}, ${s.notifications} thong bao${s.bootstrap ? ' (lan dau: chi ghi, khong gui)' : ''}`);
    }
  } finally {
    running = false;
  }
}

const tick = () => {
  runOnce().catch((err) => console.error('[risk] loi khi quet nguy co tre han:', err));
};

export function startRiskScheduler(): void {
  if (timer) return;
  first = setTimeout(tick, FIRST_RUN_DELAY_MS);
  first.unref();
  timer = setInterval(tick, CHECK_INTERVAL_MS);
  timer.unref();
}

export function stopRiskScheduler(): void {
  if (first) {
    clearTimeout(first);
    first = null;
  }
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
