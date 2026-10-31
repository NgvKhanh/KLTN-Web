// Lop goi LLM trung lap nha cung cap (buoc 6, AI_MODULE.md §6).
//
// DAY LA KHOI DUY NHAT CUA MODULE AI DUOC RA MANG. Goi qua chuan OpenAI-compatible
// (POST {baseUrl}/chat/completions) nen doi Gemini/Groq/OpenRouter... chi la doi env.
//
// HOP DONG: callLlm KHONG BAO GIO NEM LOI - moi that bai la 1 ket qua co kieu
// (LlmFailReason). Nguoi goi (ai.service) nuot moi nhanh loi va lui ve bo luat.
// Ham nay chi tra JSON THO da parse; kiem hinh dang la viec cua parseLlmDraft (Zod).
//
// Nhan cfg qua THAM SO (mac dinh env.ai) de test truyen cau hinh gia, khong phai
// nghich env luc import.
//
// KHOA API chi nam trong header Authorization. Khong bao gio dua vao log, ket qua tra
// ve hay AiRun (thong diep loi con duoc che khoa neu nha cung cap lap lai no).

import { env } from '../../config/env';
import { LLM_DRAFT_JSON_SCHEMA } from './boardPlan.schema';

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
}

/** Cac muc "ep JSON" theo thu tu thu: nha cung cap tu choi (400) thi ha xuong muc sau. */
export const RESPONSE_FORMAT_LADDER = ['json_schema', 'json_object', 'none'] as const;
export type ResponseFormatMode = (typeof RESPONSE_FORMAT_LADDER)[number];

/** Lich su ghi vao AiRun.llmFailReason (INVALID_SHAPE do parseLlmDraft/ai.service them vao). */
export type LlmFailReason =
  | 'DISABLED'
  | 'TIMEOUT'
  | 'NETWORK'
  | 'HTTP_4XX'
  | 'HTTP_5XX'
  | 'EMPTY'
  | 'BAD_JSON';

export interface LlmMessages {
  system: string;
  user: string;
}

/**
 * Luoc do JSON cho muc json_schema + muc bat dau cua thang ep JSON. Bo trong -> luoc do ke
 * hoach bang, bat dau tu json_schema (hanh vi cu). Chatbot (CHATBOT_MODULE.md §10.4) truyen
 * luoc do rieng va bat dau tu muc nha cung cap da chap nhan o luot truoc.
 */
export interface LlmFormat {
  name: string;
  schema: Record<string, unknown>;
  startMode?: ResponseFormatMode;
}

export const BOARD_PLAN_FORMAT: LlmFormat = { name: 'board_plan_draft', schema: LLM_DRAFT_JSON_SCHEMA };

export type LlmResult =
  | {
      ok: true;
      /** JSON da parse (CHUA kiem hinh dang). */
      raw: unknown;
      promptTokens: number | null;
      completionTokens: number | null;
      latencyMs: number;
      /** Muc ep JSON cuoi cung nha cung cap chap nhan. */
      formatMode: ResponseFormatMode;
    }
  | {
      ok: false;
      reason: LlmFailReason;
      status: number | null;
      /** Ngan, da che khoa; chi de ghi log/chan doan. */
      detail: string;
      latencyMs: number;
      formatMode: ResponseFormatMode | null;
    };

export const LLM_TEMPERATURE = 0.2;
/** Phan hoi lon hon muc nay la bat thuong (model lap vo han) -> coi la BAD_JSON. */
const MAX_CONTENT_CHARS = 200_000;
const MAX_DETAIL_CHARS = 200;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function tokenCount(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

function trimSlashes(url: string): string {
  let end = url.length;
  while (end > 0 && url[end - 1] === '/') end -= 1;
  return url.slice(0, end);
}

/** Che khoa (neu nha cung cap lap lai no trong thong bao loi) va cat ngan. */
function safeDetail(text: string, apiKey: string): string {
  const masked = apiKey === '' ? text : text.split(apiKey).join('***');
  // Cat TRUOC khi gop khoang trang: khong chay regex tren phan hoi dai tuy y
  return masked.slice(0, MAX_DETAIL_CHARS * 2).replace(/\s{1,20}/g, ' ').trim().slice(0, MAX_DETAIL_CHARS);
}

/**
 * Lay 1 doi tuong JSON tu noi dung model tra ve. Model khong duoc ep JSON thuong boc
 * trong rao markdown (```json ... ```) hoac them loi dan truoc/sau -> cat tu `{` dau
 * den `}` cuoi. Tra undefined neu khong ra doi tuong (mang/so/chuoi khong hop le).
 */
export function extractJsonObject(content: string): Record<string, unknown> | undefined {
  const text = content.trim();
  const attempt = (s: string): Record<string, unknown> | undefined => {
    try {
      const v: unknown = JSON.parse(s);
      return isRecord(v) ? v : undefined;
    } catch {
      return undefined;
    }
  };
  const direct = attempt(text);
  if (direct) return direct;
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first < 0 || last <= first) return undefined;
  return attempt(text.slice(first, last + 1));
}

/** Noi dung tin nhan: chuoi, hoac mang cac phan {text} (mot so nha cung cap tra vay). */
function messageText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : ''))
      .join('');
  }
  return '';
}

function responseFormatFor(mode: ResponseFormatMode, format: LlmFormat): Record<string, unknown> | undefined {
  if (mode === 'json_schema') {
    return {
      type: 'json_schema',
      json_schema: { name: format.name, strict: true, schema: format.schema },
    };
  }
  if (mode === 'json_object') return { type: 'json_object' };
  return undefined;
}

/** Cac muc cua thang tinh tu `start` tro xuong (khong co `start` -> ca thang). */
function ladderFrom(start: ResponseFormatMode | undefined): readonly ResponseFormatMode[] {
  const i = start === undefined ? 0 : RESPONSE_FORMAT_LADDER.indexOf(start);
  return i <= 0 ? RESPONSE_FORMAT_LADDER : RESPONSE_FORMAT_LADDER.slice(i);
}

export async function callLlm(
  messages: LlmMessages,
  cfg: LlmConfig = env.ai,
  format: LlmFormat = BOARD_PLAN_FORMAT
): Promise<LlmResult> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const fail = (
    reason: LlmFailReason,
    status: number | null,
    detail: string,
    formatMode: ResponseFormatMode | null
  ): LlmResult => ({ ok: false, reason, status, detail: safeDetail(detail, cfg.apiKey), latencyMs: elapsed(), formatMode });

  if (!cfg.baseUrl || !cfg.apiKey || !cfg.model) {
    return fail('DISABLED', null, 'Chua cau hinh AI_BASE_URL / AI_API_KEY / AI_MODEL', null);
  }
  const url = `${trimSlashes(cfg.baseUrl)}/chat/completions`;

  // MOT dong ho cho ca thang ep-JSON: thu 3 muc khong duoc phep keo dai gap 3 lan.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
  try {
    for (const mode of ladderFrom(format.startMode)) {
      const body: Record<string, unknown> = {
        model: cfg.model,
        temperature: LLM_TEMPERATURE,
        messages: [
          { role: 'system', content: messages.system },
          { role: 'user', content: messages.user },
        ],
      };
      const responseFormat = responseFormatFor(mode, format);
      if (responseFormat) body.response_format = responseFormat;

      let res: Response;
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (e) {
        if (controller.signal.aborted) return fail('TIMEOUT', null, `Qua ${cfg.timeoutMs}ms`, mode);
        return fail('NETWORK', null, (e as Error).message ?? 'Loi mang', mode);
      }

      let text: string;
      try {
        text = await res.text();
      } catch (e) {
        if (controller.signal.aborted) return fail('TIMEOUT', res.status, `Qua ${cfg.timeoutMs}ms`, mode);
        return fail('NETWORK', res.status, (e as Error).message ?? 'Loi doc phan hoi', mode);
      }

      if (!res.ok) {
        // 400/422 = "khong ho tro response_format nay" -> thu muc nhe hon. Loi khac (401,
        // 403, 429, 5xx) thi thu lai bang muc khac cung vo ich -> dung ngay.
        const canDowngrade = (res.status === 400 || res.status === 422) && mode !== 'none';
        if (canDowngrade) continue;
        return fail(res.status >= 500 ? 'HTTP_5XX' : 'HTTP_4XX', res.status, text, mode);
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        return fail('BAD_JSON', res.status, 'Phan hoi khong phai JSON', mode);
      }
      const first = isRecord(parsed) && Array.isArray(parsed.choices) ? (parsed.choices[0] as unknown) : undefined;
      const message = isRecord(first) && isRecord(first.message) ? first.message : undefined;
      const content = messageText(message?.content).trim();
      if (content === '') return fail('EMPTY', res.status, 'Phan hoi khong co noi dung', mode);
      if (content.length > MAX_CONTENT_CHARS) return fail('BAD_JSON', res.status, 'Noi dung qua dai', mode);

      const raw = extractJsonObject(content);
      if (raw === undefined) return fail('BAD_JSON', res.status, 'Noi dung khong phai doi tuong JSON', mode);

      const usage = isRecord((parsed as Record<string, unknown>).usage)
        ? ((parsed as Record<string, unknown>).usage as Record<string, unknown>)
        : {};
      return {
        ok: true,
        raw,
        promptTokens: tokenCount(usage.prompt_tokens),
        completionTokens: tokenCount(usage.completion_tokens),
        latencyMs: elapsed(),
        formatMode: mode,
      };
    }
    // Khong toi duoc day: muc 'none' khong ha them (400 o do da tra HTTP_4XX). Chi de thoa kieu.
    return fail('HTTP_4XX', null, 'Het muc response_format', null);
  } finally {
    clearTimeout(timer);
  }
}
