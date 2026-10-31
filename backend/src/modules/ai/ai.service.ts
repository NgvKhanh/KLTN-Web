// Dieu phoi sinh ke hoach cua module AI (AI_MODULE.md §5).
//
// Duong RULE-ONLY (buoc 4) + lop LLM tuy chon (buoc 6): co du cau hinh thi goi LLM roi
// hop nhat vao ke hoach; thieu khoa HOAC LLM loi kieu gi cung roi ve duong rule-only.
// Luon tra 200: thieu cau hinh AI / LLM chet KHONG BAO GIO la loi cua nguoi dung
// (khac voi Unsplash/Google - cac tinh nang do tra 503 khi thieu khoa).

import type { Prisma } from '../../generated/prisma/client';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { assertWorkspaceAccess } from '../workspace/workspace.service';
import { buildPlan, type PlanStats } from './ai.build';
import type { IsoDate } from './ai.dates';
import { callLlm } from './ai.llm';
import { buildLlmMessages } from './ai.prompt';
import { analyzeText, type PlanMode } from './ai.rules';
import { LIMITS, boardPlanSchema, parseLlmDraft, type BoardPlan, type LlmDraft, type PlanWarning } from './boardPlan.schema';

export interface GeneratePlanParams {
  userId: string;
  workspaceId: string;
  text: string;
  /** Nguon van ban (mac dinh TEXT); do client khai, chi de thong ke. */
  inputKind?: 'TEXT' | 'DOCX' | 'PDF';
  mode?: PlanMode;
  projectStart?: IsoDate;
  projectEnd?: IsoDate;
  skipWeekend: boolean;
  /** Ngay hom nay cua nguoi dung; bo trong -> lay theo gio Viet Nam. */
  today?: IsoDate;
}

export interface GeneratePlanResult {
  runId: string;
  llmUsed: boolean;
  /** Che do do MAY chon; plan.mode la che do thuc su dung (nguoi dung co the ghi de). */
  modeAuto: PlanMode;
  plan: BoardPlan;
  stats: PlanStats;
}

/** TaskFlow phuc vu nguoi Viet: "hom nay" tinh theo gio Viet Nam, khong theo UTC cua server. */
export const AI_TIME_ZONE = 'Asia/Ho_Chi_Minh';

/**
 * Ngay lich hien tai o Viet Nam. Server chay UTC nen den 07:00 sang gio VN neu dung
 * ngay UTC se ra "hom qua" va moi ngay tuong doi ("thu 6 tuan nay") lech theo.
 * Nhan `now` lam tham so de test tat dinh.
 */
export function todayInVietnam(now: Date): IsoDate {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AI_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Cat van ban qua dai tai RANH GIOI DONG (de khong cat doi 1 gach dau dong / 1 cau)
 * neu ranh gioi do nam o nua sau; khong cat doi cap ky tu thay the (emoji).
 */
export function truncateInput(text: string, max: number): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  let cutAt = max;
  const last = text.charCodeAt(cutAt - 1);
  if (last >= 0xd800 && last <= 0xdbff) cutAt -= 1; // nua dau cua cap thay the
  const head = text.slice(0, cutAt);
  const newline = head.lastIndexOf('\n');
  return { text: (newline >= max * 0.5 ? head.slice(0, newline) : head).trimEnd(), truncated: true };
}

/** LLM chi duoc goi khi DU CA BA: baseUrl, apiKey, model. */
export function isLlmAvailable(cfg: { baseUrl: string; apiKey: string; model: string } = env.ai): boolean {
  return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model);
}

export function getAiStatus(cfg = env.ai) {
  return { llmAvailable: isLlmAvailable(cfg), provider: cfg.providerLabel, model: cfg.model };
}

/** Cau hinh AI truyen qua tham so (mac dinh env.ai) de test khong phai nghich env. */
export type AiConfig = typeof env.ai;

export async function generatePlan(
  params: GeneratePlanParams,
  now: Date = new Date(),
  cfg: AiConfig = env.ai
): Promise<GeneratePlanResult> {
  // Kiem lai quyen o day (khong tin controller): moi ke hoach gan voi 1 khong gian.
  await assertWorkspaceAccess(params.userId, params.workspaceId);

  const today = params.today ?? todayInVietnam(now);
  const input = truncateInput(params.text, cfg.maxInputChars);
  const findings = analyzeText(input.text, today);
  if (findings.lines.length === 0) {
    throw new AppError('Mo ta khong co noi dung de lap ke hoach', 400);
  }
  const mode = params.mode ?? findings.mode;

  // ---- Lop LLM (tuy chon). MOI nhanh loi deu bi nuot o day: ke hoach van duoc tao bang bo luat. ----
  const meta = {
    provider: 'rule',
    model: '',
    promptTokens: null as number | null,
    completionTokens: null as number | null,
    latencyMs: null as number | null,
    llmFailReason: null as string | null,
    strictParseOk: false,
    verdictLines: 0,
  };
  const head: PlanWarning[] = [];
  let draft: LlmDraft | null = null;

  if (!isLlmAvailable(cfg)) {
    head.push({
      code: 'LLM_UNAVAILABLE',
      message: 'Kế hoạch được tạo bằng bộ luật, chưa dùng AI. Bạn nên kiểm tra và chỉnh sửa trước khi tạo bảng.',
    });
  } else {
    // callLlm hop dong la khong nem loi; .catch la luoi an toan de mot loi lap trinh o do
    // khong bien thanh 500 cho nguoi dung.
    const res = await callLlm(buildLlmMessages(mode, findings.lines), cfg).catch(
      (e: unknown) =>
        ({ ok: false, reason: 'NETWORK', status: null, detail: String((e as Error)?.message).slice(0, 200), latencyMs: 0, formatMode: null }) as const
    );
    meta.provider = cfg.providerLabel;
    meta.model = cfg.model;
    meta.latencyMs = res.latencyMs;
    const failed = (reason: string) => {
      meta.llmFailReason = reason;
      head.push({
        code: 'LLM_FAILED',
        message: 'Không lấy được kết quả từ AI nên kế hoạch được tạo bằng bộ luật. Bạn nên kiểm tra và chỉnh sửa trước khi tạo bảng.',
      });
    };
    if (!res.ok) {
      // Khong log noi dung van ban nguoi dung; detail da che khoa va cat ngan
      console.warn(`[ai] LLM loi: ${res.reason} status=${res.status ?? '-'} ${res.detail}`);
      failed(res.reason);
    } else {
      meta.promptTokens = res.promptTokens;
      meta.completionTokens = res.completionTokens;
      const parsed = parseLlmDraft(res.raw, { lineCount: findings.lines.length, mode });
      if (!parsed.ok) {
        console.warn(`[ai] LLM tra sai hinh dang: ${parsed.issues.join('; ')}`);
        failed('INVALID_SHAPE');
      } else {
        draft = parsed.draft;
        meta.strictParseOk = parsed.strictParseOk;
        meta.verdictLines = parsed.verdictLines;
        if (parsed.repairs.length > 0) {
          head.push({
            code: 'DRAFT_REPAIRED',
            message: 'Kết quả của AI phải sửa nhẹ vài chỗ (cắt độ dài, bỏ mục sai) trước khi dùng.',
          });
        }
      }
    }
  }

  const { plan, stats, draftUsed, droppedCards } = buildPlan(
    findings,
    {
      mode,
      today,
      projectStart: params.projectStart ?? null,
      projectEnd: params.projectEnd ?? null,
      skipWeekend: params.skipWeekend,
    },
    draft
  );
  if (draft !== null && !draftUsed) {
    // AI tra JSON hop le nhung khong con the nao dung duoc (vd STRUCTURED: moi the deu ao)
    meta.llmFailReason = 'EMPTY';
    head.push({
      code: 'LLM_FAILED',
      message: 'AI không đề xuất được thẻ hợp lệ nào nên kế hoạch được tạo bằng bộ luật. Bạn nên kiểm tra và chỉnh sửa trước khi tạo bảng.',
    });
  }
  if (input.truncated) {
    head.push({
      code: 'INPUT_TRUNCATED',
      message: `Mô tả dài hơn ${env.ai.maxInputChars} ký tự nên chỉ phần đầu được phân tích.`,
    });
  }
  plan.warnings = [...head, ...plan.warnings].slice(0, LIMITS.maxWarnings);

  // Luoi an toan: neu ta tu sinh ra ke hoach sai hop dong thi do la LOI CUA MINH.
  const checked = boardPlanSchema.safeParse(plan);
  if (!checked.success) {
    console.error('[ai] buildPlan sinh ra ke hoach khong hop le:', JSON.stringify(checked.error.issues.slice(0, 5)));
    throw new AppError('Khong tao duoc ke hoach tu mo ta nay', 500);
  }

  const run = await prisma.aiRun.create({
    data: {
      userId: params.userId,
      workspaceId: params.workspaceId,
      actorKey: params.userId,
      inputKind: params.inputKind ?? 'TEXT',
      inputText: input.text, // ban DA CAT: sourceLine cua ke hoach khop voi dung van ban nay
      inputChars: input.text.length,
      inputLines: findings.lines.length,
      modeAuto: findings.mode,
      mode,
      structuredRatio: findings.structuredRatio,
      llmUsed: draftUsed,
      provider: meta.provider,
      model: meta.model,
      // latencyMs/token la so lieu cua LOP LLM: de trong (null) o duong rule-only
      promptTokens: meta.promptTokens,
      completionTokens: meta.completionTokens,
      latencyMs: meta.latencyMs,
      llmFailReason: meta.llmFailReason,
      strictParseOk: meta.strictParseOk,
      plan: plan as unknown as Prisma.InputJsonValue,
      cardCount: stats.totalCards,
      droppedCards,
      verdictLines: meta.verdictLines,
      warnings: plan.warnings as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  return { runId: run.id, llmUsed: draftUsed, modeAuto: findings.mode, plan, stats };
}
