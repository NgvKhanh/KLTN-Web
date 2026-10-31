import { api } from '../axios';
import type { Board } from '../../types/board';
import type {
  AiStatus,
  BoardPlan,
  ExtractedDocument,
  GeneratePlanInput,
  GeneratePlanResult,
} from '../../types/ai';

// GET /api/ai/status - "AI co san sang khong" (khong bao gio 503: thieu cau hinh AI khong phai loi).
export async function fetchAiStatus(): Promise<AiStatus> {
  const res = await api.get<{ data: AiStatus }>('/ai/status');
  return res.data.data;
}

// POST /api/ai/documents/extract - trich chu tu .docx/.pdf. KHONG goi LLM, khong ghi DB.
// Truyen FormData: axios tu dat Content-Type multipart kem boundary, khong duoc tu dat tay.
export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<{ data: ExtractedDocument }>('/ai/documents/extract', form);
  return res.data.data;
}

// POST /api/ai/board-plans - sinh ke hoach de XEM TRUOC (chua tao bang nao). Server luon tra 200 ke ca LLM chet.
export async function generateBoardPlan(input: GeneratePlanInput): Promise<GeneratePlanResult> {
  const res = await api.post<{ data: GeneratePlanResult }>('/ai/board-plans', input);
  return res.data.data;
}

// POST /api/ai/board-plans/:runId/apply - tao bang THAT tu ke hoach nguoi dung da xem/sua.
// Tra ve bang cung hinh dang voi createBoard de goi thang upsertBoard.
export async function applyBoardPlan(runId: string, plan: BoardPlan): Promise<Board> {
  const res = await api.post<{ data: { board: Board } }>(
    `/ai/board-plans/${encodeURIComponent(runId)}/apply`,
    { plan }
  );
  return res.data.data.board;
}
