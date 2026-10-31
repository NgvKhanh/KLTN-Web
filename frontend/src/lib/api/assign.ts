import { api } from '../axios';
import type {
  AssignOutcomeResult,
  AssignPlanResult,
  AssignProfile,
  AssignProfileInput,
  AssignSuggestionResult,
  AssignWeights,
  AssignWeightsView,
  DeclaredCvUploadResult,
  DeclaredProfile,
  DeclaredProfileInput,
} from '../../types/assign';

// Lop goi API cua module goi y phan cong (ASSIGN_MODULE.md §10). Moi ham tra `res.data.data`.

// GET /api/cards/:cardId/assignment-suggestions - xep hang nhung nguoi co the nhan the.
// LUU Y: co ghi 1 dong nhat ky o server va co gioi han toc do (60 luot / 10 phut) -> chi goi khi nguoi dung MO o Thanh vien.
export async function fetchAssignSuggestions(cardId: string): Promise<AssignSuggestionResult> {
  const res = await api.get<{ data: AssignSuggestionResult }>(
    `/cards/${encodeURIComponent(cardId)}/assignment-suggestions`
  );
  return res.data.data;
}

// POST /api/lists/:listId/assignment-plan - chia cac the CHUA CO NGUOI NHAN cua danh sach (lop 2), CHI XEM TRUOC.
// Dung POST nhung KHONG ghi gi o server; ton tai nguyen nen co gioi han toc do (10 luot / 10 phut) -> chi goi khi nguoi dung
// mo man hinh chia viec. Giao that dung addCardMember (lib/api/card.ts) tung the.
export async function fetchAssignPlan(listId: string): Promise<AssignPlanResult> {
  const res = await api.post<{ data: AssignPlanResult }>(`/lists/${encodeURIComponent(listId)}/assignment-plan`);
  return res.data.data;
}

// POST /api/assignment/runs/:runId/outcome - ghi nguoi thuc su duoc giao (nguoi do phai DANG o trong the).
export async function recordAssignOutcome(
  runId: string,
  chosenUserId: string
): Promise<AssignOutcomeResult> {
  const res = await api.post<{ data: AssignOutcomeResult }>(
    `/assignment/runs/${encodeURIComponent(runId)}/outcome`,
    { chosenUserId }
  );
  return res.data.data;
}

const weightsUrl = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/assignment-weights`;
const profileUrl = (workspaceId: string) =>
  `/workspaces/${encodeURIComponent(workspaceId)}/assignment-profile`;

// GET .../assignment-weights - moi thanh vien khong gian xem duoc (kem lich su doi va so lieu phan hoi).
export async function fetchAssignWeights(workspaceId: string): Promise<AssignWeightsView> {
  const res = await api.get<{ data: AssignWeightsView }>(weightsUrl(workspaceId));
  return res.data.data;
}

// PUT .../assignment-weights - chi OWNER/ADMIN. Bon so (them Ho so), moi so trong [0,05; 0,70], tong = 1 (server tu choi neu sai).
export async function saveAssignWeights(
  workspaceId: string,
  weights: AssignWeights
): Promise<AssignWeightsView> {
  const res = await api.put<{ data: AssignWeightsView }>(weightsUrl(workspaceId), weights);
  return res.data.data;
}

// DELETE .../assignment-weights - dat lai mac dinh (36/24/20/20) va dua so luot phan hoi ve 0 (chi OWNER/ADMIN).
export async function resetAssignWeights(workspaceId: string): Promise<AssignWeightsView> {
  const res = await api.delete<{ data: AssignWeightsView }>(weightsUrl(workspaceId));
  return res.data.data;
}

// GET .../assignment-profile - ho so lam viec cua CHINH nguoi goi trong khong gian.
export async function fetchAssignProfile(workspaceId: string): Promise<AssignProfile> {
  const res = await api.get<{ data: AssignProfile }>(profileUrl(workspaceId));
  return res.data.data;
}

// PUT .../assignment-profile - so the song song toi da (1-30) va tam nghi den (ISO co Z, hoac null).
export async function saveAssignProfile(
  workspaceId: string,
  input: AssignProfileInput
): Promise<AssignProfile> {
  const res = await api.put<{ data: AssignProfile }>(profileUrl(workspaceId), input);
  return res.data.data;
}

// ---------- Ho so tu khai cua CHINH nguoi dung (ky nang, cong viec da lam, CV) - ASSIGN_MODULE.md §17.9 ----------

const MY_PROFILE = '/me/assign-profile';

// GET /api/me/assign-profile - chua khai thi tra ho so rong (bat "dung cho goi y").
export async function fetchDeclaredProfile(): Promise<DeclaredProfile> {
  const res = await api.get<{ data: DeclaredProfile }>(MY_PROFILE);
  return res.data.data;
}

// PUT /api/me/assign-profile - cong tac, ky nang, cong viec da lam, chu CV (da sua). Tep CV di qua uploadDeclaredCv.
export async function saveDeclaredProfile(input: DeclaredProfileInput): Promise<DeclaredProfile> {
  const res = await api.put<{ data: DeclaredProfile }>(MY_PROFILE, input);
  return res.data.data;
}

// POST /api/me/assign-profile/cv - tep .pdf / .docx <= 5MB o truong "file"; may chu TRICH CHU (khong goi AI) va tra ve de sua.
export async function uploadDeclaredCv(file: File): Promise<DeclaredCvUploadResult> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<{ data: DeclaredCvUploadResult }>(`${MY_PROFILE}/cv`, form);
  return res.data.data;
}

// DELETE /api/me/assign-profile/cv - xoa tep, chu trich va moi thong tin CV.
export async function deleteDeclaredCv(): Promise<DeclaredProfile> {
  const res = await api.delete<{ data: DeclaredProfile }>(`${MY_PROFILE}/cv`);
  return res.data.data;
}

// Tai tep CV: lien ket thuong (trinh duyet gui cookie, may chu ep tai xuong). Nguoi khong co quyen nhan 404.
const API_URL = import.meta.env.VITE_API_URL as string;
export const myCvUrl = () => `${API_URL}${MY_PROFILE}/cv`;
export const userCvUrl = (userId: string) => `${API_URL}/users/${encodeURIComponent(userId)}/assign-profile/cv`;

/** Toi da so nguoi moi lan hoi (khop gioi han may chu). */
export const CV_ACCESS_MAX_IDS = 200;

// GET /api/me/assign-profile/cv-access?userIds=a,b - trong danh sach, ai minh tai duoc CV (co tep + co quyen). Danh sach rong ->
// khong goi may chu. Dai hon 200 nguoi -> chia nhieu lan.
export async function fetchCvAccess(userIds: readonly string[]): Promise<string[]> {
  const ids = [...new Set(userIds)];
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += CV_ACCESS_MAX_IDS) chunks.push(ids.slice(i, i + CV_ACCESS_MAX_IDS));
  const parts = await Promise.all(
    chunks.map((chunk) =>
      api
        .get<{ data: { userIds: string[] } }>(`${MY_PROFILE}/cv-access`, { params: { userIds: chunk.join(',') } })
        .then((res) => res.data.data.userIds)
    )
  );
  return parts.flat();
}
