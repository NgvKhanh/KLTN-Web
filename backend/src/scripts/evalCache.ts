// Cache phan hoi THO cua LLM cho bo danh gia (buoc 10). Tach khoi evaluateAi.ts de test duoc.
//
// Muc dich: chay lai (hoac doi cach cham diem, sua bo hop nhat) KHONG ton them request va cho DUNG ket qua
// cu -> so sanh "truoc/sau" cong bang tren cung mot phan hoi cua AI.
//
// Cache: (1) phan hoi thanh cong; (2) loi thuoc ve NOI DUNG phan hoi (BAD_JSON, EMPTY): mo hinh tra khong
// dung dinh dang - day la mot DO DAC (ti le loi cua nhanh), chay lai khong duoc "thu lai cho den khi duoc".
// KHONG cache loi ha tang (429, 5xx, het gio, mat mang, sai khoa): do khong noi gi ve mo hinh va thu lai la dung.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LlmMessages, LlmResult } from '../modules/ai/ai.llm';
/** Ten nhanh / loai goi (module sinh bang: rule|hybrid|llm-only...; chatbot: chat-intent). */
type Arm = string;

export interface CacheInfo {
  arm: Arm;
  sampleId: string;
  run: number;
  baseUrl: string;
  model: string;
}

// CODE_REVIEW.md #14: khoa TRUOC DAY thieu dinh danh endpoint/nha cung cap - doi
// AI_BASE_URL nhung giu nguyen ten model (vd cung goi "llama-3.3-70b-versatile"
// o Groq lan OpenRouter) va cung thu muc cache se vo tinh doc nham phan hoi cua
// nha cung cap CU. Them baseUrl vao khoa: doi endpoint -> khoa khac -> tu goi
// lai, khong con doc nham cache cheo nha cung cap.
/** Khoa = nhanh + endpoint + model + lan chay + noi dung prompt: doi bat ky thu nao thi goi lai. */
export function cacheKey(arm: Arm, baseUrl: string, model: string, run: number, m: LlmMessages): string {
  return createHash('sha256').update(JSON.stringify({ arm, baseUrl, model, run, system: m.system, user: m.user })).digest('hex').slice(0, 32);
}

const CONTENT_FAILURES: ReadonlySet<string> = new Set(['BAD_JSON', 'EMPTY']);

export function isCacheable(res: LlmResult): boolean {
  return res.ok || CONTENT_FAILURES.has(res.reason);
}

export function cacheRead(dir: string, key: string): LlmResult | null {
  try {
    const entry = JSON.parse(fs.readFileSync(path.join(dir, `${key}.json`), 'utf8')) as { res?: LlmResult };
    const res = entry.res;
    if (res === undefined || typeof res.latencyMs !== 'number') return null;
    if (res.ok === true) return typeof res.raw === 'object' && res.raw !== null ? res : null;
    return res.ok === false && CONTENT_FAILURES.has(res.reason) ? res : null;
  } catch {
    return null;
  }
}

/** Ghi neu dang cache duoc; tra true neu da ghi. */
export function cacheWrite(dir: string, key: string, info: CacheInfo, res: LlmResult): boolean {
  if (!isCacheable(res)) return false;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${key}.json`), JSON.stringify({ ...info, savedAt: new Date().toISOString(), res }), 'utf8');
  return true;
}
