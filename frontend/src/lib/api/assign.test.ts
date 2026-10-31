import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }));
vi.mock('../axios', () => ({ api: mocks }));

import {
  CV_ACCESS_MAX_IDS,
  deleteDeclaredCv,
  fetchAssignPlan,
  fetchAssignProfile,
  fetchAssignSuggestions,
  fetchAssignWeights,
  fetchCvAccess,
  fetchDeclaredProfile,
  myCvUrl,
  recordAssignOutcome,
  resetAssignWeights,
  saveAssignProfile,
  saveAssignWeights,
  saveDeclaredProfile,
  uploadDeclaredCv,
  userCvUrl,
} from './assign';

// Lop goi API cua module goi y phan cong: dung DUONG DAN (ma hoa id), dung THAN yeu cau, tra `res.data.data`.
// Cac test giao dien mock lop nay nen day la cho DUY NHAT kiem tra no.

beforeEach(() => {
  vi.resetAllMocks();
});

describe('lib/api/assign', () => {
  it('fetchAssignSuggestions: GET /cards/:id/assignment-suggestions (id duoc ma hoa), tra data.data', async () => {
    const data = { runId: 'r1', candidates: [] };
    mocks.get.mockResolvedValue({ data: { data } });
    await expect(fetchAssignSuggestions('c1')).resolves.toBe(data);
    expect(mocks.get).toHaveBeenCalledWith('/cards/c1/assignment-suggestions');
    await fetchAssignSuggestions('a/b?c');
    expect(mocks.get).toHaveBeenLastCalledWith('/cards/a%2Fb%3Fc/assignment-suggestions');
  });

  it('fetchAssignPlan: POST /lists/:id/assignment-plan (id duoc ma hoa, khong than yeu cau), tra data.data', async () => {
    const data = { rows: [], people: [] };
    mocks.post.mockResolvedValue({ data: { data } });
    await expect(fetchAssignPlan('l1')).resolves.toBe(data);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/lists/l1/assignment-plan');
    await fetchAssignPlan('a/b?c');
    expect(mocks.post).toHaveBeenLastCalledWith('/lists/a%2Fb%3Fc/assignment-plan');
  });

  it('recordAssignOutcome: POST /assignment/runs/:runId/outcome voi { chosenUserId }, tra data.data', async () => {
    const data = { runId: 'r1', accepted: true };
    mocks.post.mockResolvedValue({ data: { data } });
    await expect(recordAssignOutcome('r1', 'u1')).resolves.toBe(data);
    expect(mocks.post).toHaveBeenCalledTimes(1);
    expect(mocks.post).toHaveBeenCalledWith('/assignment/runs/r1/outcome', { chosenUserId: 'u1' });
    await recordAssignOutcome('r/1', 'u1');
    expect(mocks.post).toHaveBeenLastCalledWith('/assignment/runs/r%2F1/outcome', { chosenUserId: 'u1' });
  });

  it('fetchAssignWeights: GET /workspaces/:id/assignment-weights', async () => {
    const data = { weights: { experience: 0.45 } };
    mocks.get.mockResolvedValue({ data: { data } });
    await expect(fetchAssignWeights('w1')).resolves.toBe(data);
    expect(mocks.get).toHaveBeenCalledWith('/workspaces/w1/assignment-weights');
    await fetchAssignWeights('w/1');
    expect(mocks.get).toHaveBeenLastCalledWith('/workspaces/w%2F1/assignment-weights'); // id duoc ma hoa
  });

  it('saveAssignWeights: PUT cung duong dan, than la BON trong so (khong them khoa nao khac)', async () => {
    const data = { custom: true };
    mocks.put.mockResolvedValue({ data: { data } });
    const w = { experience: 0.4, reliability: 0.3, availability: 0.2, declared: 0.1 };
    await expect(saveAssignWeights('w1', w)).resolves.toBe(data);
    expect(mocks.put).toHaveBeenCalledWith('/workspaces/w1/assignment-weights', w);
    await saveAssignWeights('w/1', w);
    expect(mocks.put).toHaveBeenLastCalledWith('/workspaces/w%2F1/assignment-weights', w);
  });

  it('resetAssignWeights: DELETE cung duong dan, tra data.data', async () => {
    const data = { custom: false };
    mocks.delete.mockResolvedValue({ data: { data } });
    await expect(resetAssignWeights('w1')).resolves.toBe(data);
    expect(mocks.delete).toHaveBeenCalledWith('/workspaces/w1/assignment-weights');
    await resetAssignWeights('w/1');
    expect(mocks.delete).toHaveBeenLastCalledWith('/workspaces/w%2F1/assignment-weights');
  });

  it('fetchAssignProfile / saveAssignProfile: /workspaces/:id/assignment-profile, than { maxParallelCards, pausedUntil }', async () => {
    const data = { maxParallelCards: 5 };
    mocks.get.mockResolvedValue({ data: { data } });
    await expect(fetchAssignProfile('w/1')).resolves.toBe(data);
    expect(mocks.get).toHaveBeenCalledWith('/workspaces/w%2F1/assignment-profile');

    mocks.put.mockResolvedValue({ data: { data: { maxParallelCards: 3 } } });
    const input = { maxParallelCards: 3, pausedUntil: '2026-10-05T16:59:59.999Z' };
    await expect(saveAssignProfile('w1', input)).resolves.toEqual({ maxParallelCards: 3 });
    expect(mocks.put).toHaveBeenCalledWith('/workspaces/w1/assignment-profile', input);
    await saveAssignProfile('w1', { maxParallelCards: 5, pausedUntil: null });
    expect(mocks.put).toHaveBeenLastCalledWith('/workspaces/w1/assignment-profile', { maxParallelCards: 5, pausedUntil: null });
  });

  it('ho so tu khai: GET / PUT /me/assign-profile (than giu nguyen), POST cv la FormData truong "file", DELETE cv', async () => {
    const data = { skillsText: 'React' };
    mocks.get.mockResolvedValue({ data: { data } });
    await expect(fetchDeclaredProfile()).resolves.toBe(data);
    expect(mocks.get).toHaveBeenCalledWith('/me/assign-profile');

    const input = { useForAssign: true, skillsText: 'React', workItems: [{ title: 'A' }], cvText: null };
    mocks.put.mockResolvedValue({ data: { data } });
    await expect(saveDeclaredProfile(input)).resolves.toBe(data);
    expect(mocks.put).toHaveBeenCalledWith('/me/assign-profile', input);

    const up = { text: 'chu', truncated: false };
    mocks.post.mockResolvedValue({ data: { data: up } });
    const file = new File(['x'], 'cv.pdf', { type: 'application/pdf' });
    await expect(uploadDeclaredCv(file)).resolves.toBe(up);
    const [url, form] = mocks.post.mock.calls[0]!;
    expect(url).toBe('/me/assign-profile/cv');
    expect(form).toBeInstanceOf(FormData);
    expect((form as FormData).get('file')).toBe(file);
    expect([...(form as FormData).keys()]).toEqual(['file']);

    mocks.delete.mockResolvedValue({ data: { data } });
    await expect(deleteDeclaredCv()).resolves.toBe(data);
    expect(mocks.delete).toHaveBeenCalledWith('/me/assign-profile/cv');
  });

  it('duong dan tai CV: cua minh / cua thanh vien (id duoc ma hoa), goc la VITE_API_URL', () => {
    const base = import.meta.env.VITE_API_URL as string;
    expect(base).toMatch(/^https?:/);
    expect(myCvUrl()).toBe(`${base}/me/assign-profile/cv`);
    expect(userCvUrl('u1')).toBe(`${base}/users/u1/assign-profile/cv`);
    expect(userCvUrl('a/b?c')).toBe(`${base}/users/a%2Fb%3Fc/assign-profile/cv`);
  });

  it('fetchCvAccess: GET /me/assign-profile/cv-access?userIds=a,b (bo trung); rong -> khong goi; > 200 nguoi -> chia nhieu lan, gop ket qua', async () => {
    mocks.get.mockResolvedValue({ data: { data: { userIds: ['b'] } } });
    await expect(fetchCvAccess(['a', 'b', 'a'])).resolves.toEqual(['b']);
    expect(mocks.get).toHaveBeenCalledWith('/me/assign-profile/cv-access', { params: { userIds: 'a,b' } });

    mocks.get.mockClear();
    await expect(fetchCvAccess([])).resolves.toEqual([]);
    expect(mocks.get).not.toHaveBeenCalled();

    expect(CV_ACCESS_MAX_IDS).toBe(200);
    const ids = Array.from({ length: 201 }, (_, i) => `u${i}`);
    mocks.get.mockResolvedValueOnce({ data: { data: { userIds: ['u0'] } } }).mockResolvedValueOnce({ data: { data: { userIds: ['u200'] } } });
    await expect(fetchCvAccess(ids)).resolves.toEqual(['u0', 'u200']);
    expect(mocks.get).toHaveBeenCalledTimes(2);
    expect(mocks.get.mock.calls[0]![1]).toEqual({ params: { userIds: ids.slice(0, 200).join(',') } });
    expect(mocks.get.mock.calls[1]![1]).toEqual({ params: { userIds: 'u200' } });
  });

  it('loi cua may chu duoc day nguyen (khong nuot): giao dien tu lay thong diep', async () => {
    const err = Object.assign(new Error('429'), { response: { status: 429 } });
    mocks.get.mockRejectedValue(err);
    await expect(fetchAssignSuggestions('c1')).rejects.toBe(err);
    mocks.post.mockRejectedValue(err);
    await expect(recordAssignOutcome('r1', 'u1')).rejects.toBe(err);
  });
});
