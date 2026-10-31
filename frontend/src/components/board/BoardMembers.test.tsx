import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BoardMember } from '../../types/board';

// ----- Mock API bang -----
const fetchJoinRequests = vi.fn().mockResolvedValue([]);
const getInviteLink = vi.fn().mockResolvedValue({ token: null, url: null });
vi.mock('../../lib/api/board', () => ({
  fetchJoinRequests: (...a: unknown[]) => fetchJoinRequests(...a),
  getInviteLink: (...a: unknown[]) => getInviteLink(...a),
  createInviteLink: vi.fn().mockResolvedValue({ token: 't', url: 'u' }),
  disableInviteLink: vi.fn().mockResolvedValue(undefined),
  approveJoinRequest: vi.fn(),
  rejectJoinRequest: vi.fn(),
}));

// ----- Mock quyen xem CV (may chu quyet dinh; lop goi API co test rieng) -----
const fetchCvAccess = vi.fn().mockResolvedValue([]);
vi.mock('../../lib/api/assign', () => ({
  fetchCvAccess: (...a: unknown[]) => fetchCvAccess(...a),
  userCvUrl: (id: string) => `http://api.test/users/${id}/assign-profile/cv`,
}));

// ----- Mock socket: ghi lai handler de test tu ban su kien -----
const socketHandlers = new Map<string, ((...args: unknown[]) => void)[]>();
vi.mock('../../lib/socket', () => ({
  socket: {
    on: (ev: string, fn: (...args: unknown[]) => void) => {
      socketHandlers.set(ev, [...(socketHandlers.get(ev) ?? []), fn]);
    },
    off: (ev: string, fn: (...args: unknown[]) => void) => {
      socketHandlers.set(
        ev,
        (socketHandlers.get(ev) ?? []).filter((f) => f !== fn)
      );
    },
  },
}));
function emitSocket(ev: string) {
  for (const fn of socketHandlers.get(ev) ?? []) fn();
}

import BoardMembers from './BoardMembers';

const OWNER: BoardMember = {
  id: 'm-owner',
  boardId: 'b1',
  userId: 'u-owner',
  role: 'OWNER',
  user: { id: 'u-owner', name: 'Chu Bang', email: 'owner@x.com', avatarUrl: null },
};
const MEMBER: BoardMember = {
  id: 'm-1',
  boardId: 'b1',
  userId: 'u-1',
  role: 'MEMBER',
  user: { id: 'u-1', name: 'Thanh Vien', email: 'member@x.com', avatarUrl: null },
};

function setup(overrides: Partial<React.ComponentProps<typeof BoardMembers>> = {}) {
  const props = {
    boardId: 'b1',
    members: [OWNER, MEMBER],
    currentUserId: 'u-owner',
    isOwner: true,
    onAdd: vi.fn().mockResolvedValue({ kind: 'member', member: MEMBER }),
    onChangeRole: vi.fn().mockResolvedValue(undefined),
    onRemove: vi.fn().mockResolvedValue(undefined),
    onTransferOwnership: vi.fn().mockResolvedValue(undefined),
    onApproved: vi.fn(),
    ...overrides,
  };
  render(<BoardMembers {...props} />);
  return props;
}

beforeEach(() => {
  socketHandlers.clear();
  fetchJoinRequests.mockClear();
  getInviteLink.mockClear();
});
afterEach(() => vi.clearAllMocks());

describe('BoardMembers - nut "Xem CV"', () => {
  it('chua mo danh sach -> khong hoi may chu; mo -> hoi MOT lan cho ca danh sach; chi nguoi may chu cho phep co nut, dung duong dan', async () => {
    fetchCvAccess.mockResolvedValue(['u-1']);
    const user = userEvent.setup();
    setup();
    expect(fetchCvAccess).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Chia sẻ bảng' }));
    const link = await screen.findByRole('link', { name: 'Xem CV của Thanh Vien' });
    expect(link).toHaveAttribute('href', 'http://api.test/users/u-1/assign-profile/cv');
    expect(fetchCvAccess).toHaveBeenCalledTimes(1);
    expect([...fetchCvAccess.mock.calls[0]![0]].sort()).toEqual(['u-1', 'u-owner']);
    expect(screen.queryByRole('link', { name: 'Xem CV của Chu Bang' })).not.toBeInTheDocument();
  });

  it('may chu khong cho ai / loi -> khong co nut nao, danh sach van hien binh thuong', async () => {
    fetchCvAccess.mockRejectedValue(new Error('500'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Chia sẻ bảng' }));
    await waitFor(() => expect(fetchCvAccess).toHaveBeenCalled());
    expect(screen.getByText('Thanh Vien')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Xem CV/ })).not.toBeInTheDocument();
    spy.mockRestore();
  });
});

describe('BoardMembers - chia se bang', () => {
  it('o moi dung placeholder "Nhap dia chi email" (khong con "hoac ten")', async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole('button', { name: 'Chia sẻ bảng' }));
    expect(screen.getByPlaceholderText('Nhập địa chỉ email')).toBeInTheDocument();
  });

  it('chu bang thay muc "Chuyen quyen so huu" va goi callback sau khi xac nhan', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Chia sẻ bảng' }));

    // Mo menu vai tro cua dong "Thanh Vien"
    const memberRow = screen.getByText('Thanh Vien').closest('li')!;
    await user.click(within(memberRow).getByRole('button', { name: 'Thành viên' }));

    const transferBtn = screen.getByRole('button', {
      name: 'Chuyển quyền sở hữu',
    });
    await user.click(transferBtn);

    // Hop thoai xac nhan
    await user.click(screen.getByRole('button', { name: 'Chuyển quyền' }));
    await waitFor(() =>
      expect(props.onTransferOwnership).toHaveBeenCalledWith('u-1')
    );
  });

  it('Quan tri vien (khong phai chu bang) KHONG thay muc "Chuyen quyen so huu"', async () => {
    const user = userEvent.setup();
    setup({
      isOwner: false,
      currentUserId: 'u-1',
      members: [OWNER, { ...MEMBER, role: 'ADMIN' }],
    });
    await user.click(screen.getByRole('button', { name: 'Chia sẻ bảng' }));
    const memberRow = screen.getByText('Thanh Vien').closest('li')!;
    await user.click(
      within(memberRow).getByRole('button', { name: 'Quản trị viên' })
    );
    expect(
      screen.queryByRole('button', { name: 'Chuyển quyền sở hữu' })
    ).not.toBeInTheDocument();
  });

  it('menu vai tro nam ngoai danh sach cuon (khong bi cat o dong cuoi); doi vai tro xong thi hop chia se van mo', async () => {
    const user = userEvent.setup();
    const props = setup();
    await user.click(screen.getByRole('button', { name: 'Chia sẻ bảng' }));
    const list = screen.getByText('Thanh Vien').closest('ul')!;
    const memberRow = screen.getByText('Thanh Vien').closest('li')!;
    await user.click(within(memberRow).getByRole('button', { name: 'Thành viên' }));

    const viewerOption = screen.getByRole('button', { name: 'Người xem' });
    // Neu menu nam trong <ul overflow-y-auto> thi dong cuoi se bi cat va khong cuon toi duoc
    expect(list.contains(viewerOption)).toBe(false);

    await user.click(viewerOption);
    expect(props.onChangeRole).toHaveBeenCalledWith('u-1', 'VIEWER');
    // Menu duoc dua ra body nen bam vao do khong duoc tinh la bam ra ngoai hop chia se
    expect(screen.getByRole('heading', { name: 'Chia sẻ bảng' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Xoá khỏi bảng' })).not.toBeInTheDocument();
  });

  it('tai lai danh sach yeu cau khi co su kien realtime board:join-requests-changed', async () => {
    setup();
    // Lan dau: fetch ngay khi mount (canManage = true)
    await waitFor(() => expect(fetchJoinRequests).toHaveBeenCalledTimes(1));
    emitSocket('board:join-requests-changed');
    await waitFor(() => expect(fetchJoinRequests).toHaveBeenCalledTimes(2));
  });

  it('openTo="requests" mo san panel o tab Yeu cau tham gia va bao onOpened', async () => {
    const onOpened = vi.fn();
    setup({ openTo: 'requests', onOpened });
    await waitFor(() => expect(onOpened).toHaveBeenCalled());
    // Panel mo + dang o tab "Yeu cau tham gia" (co dong trong)
    expect(
      await screen.findByText('Chưa có yêu cầu tham gia nào.')
    ).toBeInTheDocument();
  });
});

describe('BoardMembers - hang nguoi dang xem bang', () => {
  it('chi co minh: nhan cho trinh doc man hinh noi ro, chu thich co "(ban)"', () => {
    setup();
    expect(screen.getByRole('group', { name: 'Đang xem bảng: chỉ có bạn' })).toBeInTheDocument();
    expect(screen.getByTitle('Chu Bang (bạn) — đang xem bảng')).toBeInTheDocument();
    // Thanh vien khong online thi khong hien
    expect(screen.queryByTitle(/Thanh Vien/)).not.toBeInTheDocument();
  });

  it('co thanh vien khac dang online: hien them avatar va liet ke ten trong nhan', () => {
    setup({ onlineUserIds: ['u-1'] });
    expect(
      screen.getByRole('group', { name: 'Đang xem bảng: Chu Bang, Thanh Vien' })
    ).toBeInTheDocument();
    expect(screen.getByTitle('Thanh Vien — đang xem bảng')).toBeInTheDocument();
  });

  it('moi nguoi dang xem co mot cham "dang online" trang tri (an voi trinh doc man hinh)', () => {
    setup({ onlineUserIds: ['u-1'] });
    const group = screen.getByRole('group', { name: /Đang xem bảng/ });
    const dots = group.querySelectorAll('span[aria-hidden="true"].bg-emerald-400');
    expect(dots).toHaveLength(2);
  });

  it('nguoi online nhung khong con la thanh vien bang thi khong hien', () => {
    setup({ onlineUserIds: ['u-khong-ton-tai'] });
    expect(screen.getByRole('group', { name: 'Đang xem bảng: chỉ có bạn' })).toBeInTheDocument();
  });
});
