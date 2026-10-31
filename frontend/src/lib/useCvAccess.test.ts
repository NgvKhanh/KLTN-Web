import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchCvAccess = vi.fn();
vi.mock('./api/assign', () => ({ fetchCvAccess: (...a: unknown[]) => fetchCvAccess(...a) }));

import { useCvAccess } from './useCvAccess';

// Hook nut "Xem CV" o danh sach thanh vien: hoi may chu mot lan cho ca danh sach, bo ket qua cu, loi -> khong ai.

beforeEach(() => {
  fetchCvAccess.mockReset();
});

describe('useCvAccess', () => {
  it('tra tap nguoi may chu cho phep; hoi voi danh sach da bo trung', async () => {
    fetchCvAccess.mockResolvedValue(['b']);
    const { result } = renderHook(() => useCvAccess(['a', 'b', 'a']));
    expect(result.current.size).toBe(0); // chua ve
    await waitFor(() => expect(result.current.has('b')).toBe(true));
    expect(result.current.has('a')).toBe(false);
    expect(fetchCvAccess).toHaveBeenCalledTimes(1);
    expect([...fetchCvAccess.mock.calls[0]![0]].sort()).toEqual(['a', 'b']);
  });

  it('enabled = false hoac danh sach rong -> khong goi may chu, tap rong', () => {
    renderHook(() => useCvAccess(['a'], false));
    renderHook(() => useCvAccess([]));
    expect(fetchCvAccess).not.toHaveBeenCalled();
  });

  it('cung danh sach (khac thu tu / mang moi moi lan ve) -> KHONG hoi lai', async () => {
    fetchCvAccess.mockResolvedValue(['a']);
    const { result, rerender } = renderHook(({ ids }) => useCvAccess(ids), { initialProps: { ids: ['a', 'b'] } });
    await waitFor(() => expect(result.current.has('a')).toBe(true));
    rerender({ ids: ['b', 'a'] });
    rerender({ ids: ['a', 'b'] });
    expect(fetchCvAccess).toHaveBeenCalledTimes(1);
    expect(result.current.has('a')).toBe(true);
  });

  it('doi danh sach khi yeu cau cu chua ve: ket qua cu ve muon bi bo; trong luc cho danh sach moi -> tap rong', async () => {
    let resolveOld!: (v: string[]) => void;
    fetchCvAccess.mockReturnValueOnce(new Promise((r) => (resolveOld = r))).mockResolvedValueOnce(['c']);
    const { result, rerender } = renderHook(({ ids }) => useCvAccess(ids), { initialProps: { ids: ['a'] } });
    rerender({ ids: ['c'] });
    await waitFor(() => expect(result.current.has('c')).toBe(true));
    await act(async () => resolveOld(['a']));
    expect(result.current.has('a')).toBe(false);
    expect(result.current.has('c')).toBe(true);
  });

  it('vua doi sang danh sach moi (chua ve) -> KHONG tra ket qua cua danh sach cu', async () => {
    fetchCvAccess.mockResolvedValueOnce(['a']).mockReturnValueOnce(new Promise(() => {}));
    const { result, rerender } = renderHook(({ ids }) => useCvAccess(ids), { initialProps: { ids: ['a'] } });
    await waitFor(() => expect(result.current.has('a')).toBe(true));
    rerender({ ids: ['a', 'b'] });
    expect(result.current.size).toBe(0);
  });

  it('tat enabled sau khi da co ket qua -> tap rong (khong hien nut cu)', async () => {
    fetchCvAccess.mockResolvedValue(['a']);
    const { result, rerender } = renderHook(({ on }) => useCvAccess(['a'], on), { initialProps: { on: true } });
    await waitFor(() => expect(result.current.has('a')).toBe(true));
    rerender({ on: false });
    expect(result.current.size).toBe(0);
  });

  it('loi may chu -> tap rong, chi ghi log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchCvAccess.mockRejectedValue(new Error('500'));
    const { result } = renderHook(() => useCvAccess(['a']));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(result.current.size).toBe(0);
    spy.mockRestore();
  });
});
