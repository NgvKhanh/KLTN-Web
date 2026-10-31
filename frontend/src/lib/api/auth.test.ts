import { describe, expect, it, vi } from 'vitest';

const patchMock = vi.fn().mockResolvedValue({ data: {} });
vi.mock('../axios', () => ({
  api: { patch: (...a: unknown[]) => patchMock(...a) },
}));

const connectSocketMock = vi.fn();
const disconnectSocketMock = vi.fn();
vi.mock('../socket', () => ({
  connectSocket: () => connectSocketMock(),
  disconnectSocket: () => disconnectSocketMock(),
}));

import { changePassword } from './auth';

// Van de moi (vong 3) #2: doi mat khau xong phai chu dong ngat+noi lai socket,
// vi Socket.IO KHONG tu ket noi lai khi bi SERVER chu dong ngat (cach backend
// dang lam khi thu hoi tokenVersion).
describe('#2 (vong 3) changePassword() phai tu ngat + noi lai socket', () => {
  it('goi disconnectSocket() TRUOC roi connectSocket() SAU khi doi mat khau thanh cong', async () => {
    patchMock.mockClear();
    connectSocketMock.mockClear();
    disconnectSocketMock.mockClear();

    await changePassword({
      currentPassword: 'MatKhauCu1',
      newPassword: 'MatKhauMoi1',
    });

    expect(patchMock).toHaveBeenCalledWith('/auth/password', {
      currentPassword: 'MatKhauCu1',
      newPassword: 'MatKhauMoi1',
    });
    expect(disconnectSocketMock).toHaveBeenCalledTimes(1);
    expect(connectSocketMock).toHaveBeenCalledTimes(1);

    // Thu tu: ngat truoc, noi lai sau (de dam bao noi lai voi cookie MOI ke
    // ca khi su kien server-ngat chua kip toi client).
    const disconnectOrder = disconnectSocketMock.mock.invocationCallOrder[0]!;
    const connectOrder = connectSocketMock.mock.invocationCallOrder[0]!;
    expect(disconnectOrder).toBeLessThan(connectOrder);
  });

  it('API that bai -> KHONG dung toi socket (khong ngat/noi lai nham)', async () => {
    patchMock.mockClear();
    connectSocketMock.mockClear();
    disconnectSocketMock.mockClear();
    patchMock.mockRejectedValueOnce(new Error('Mat khau hien tai khong dung'));

    await expect(
      changePassword({ currentPassword: 'Sai', newPassword: 'MoiXYZ1' })
    ).rejects.toThrow();

    expect(disconnectSocketMock).not.toHaveBeenCalled();
    expect(connectSocketMock).not.toHaveBeenCalled();
  });
});
