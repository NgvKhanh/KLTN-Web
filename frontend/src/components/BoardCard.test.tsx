import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { Board } from '../types/board';
import BoardCard from './BoardCard';

const BASE: Board = {
  id: 'b1',
  ownerId: 'u1',
  workspaceId: 'w1',
  name: 'Sprint 4: Đang chạy',
  color: '#7c3aed',
  backgroundImage: null,
  visibility: 'WORKSPACE',
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-27T05:00:00Z',
  workspaceName: 'Nhóm Website bán hàng',
  memberCount: 5,
  cardCount: 40,
  doneCount: 10,
  isOwner: true,
  isStarred: false,
};

function renderCard(over: Partial<Board> = {}) {
  return render(
    <MemoryRouter>
      <BoardCard
        board={{ ...BASE, ...over }}
        onChanged={vi.fn()}
        onRequestDelete={vi.fn()}
        onToggleStar={vi.fn()}
      />
    </MemoryRouter>
  );
}

describe('BoardCard - thông tin và tiến độ', () => {
  it('hiện tên bảng, không gian làm việc, số thành viên và liên kết mở bảng', () => {
    renderCard();
    expect(screen.getByText('Sprint 4: Đang chạy')).toBeInTheDocument();
    expect(screen.getByText('Nhóm Website bán hàng · 5 thành viên')).toBeInTheDocument();
    expect(screen.getByRole('link')).toHaveAttribute('href', '/boards/b1');
  });

  it('thanh tiến độ có giá trị đúng và câu chữ đọc được', () => {
    renderCard({ cardCount: 40, doneCount: 10 });
    const bar = screen.getByRole('progressbar', { name: 'Tiến độ hoàn thành thẻ' });
    expect(bar).toHaveAttribute('aria-valuenow', '25');
    expect(screen.getByText('10/40 thẻ hoàn thành')).toBeInTheDocument();
  });

  it('làm tròn phần trăm và không vượt 100 khi xong hết', () => {
    renderCard({ cardCount: 3, doneCount: 3 });
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });

  it('bảng chưa có thẻ: không thanh tiến độ, không chia cho 0, ghi "Chưa có thẻ"', () => {
    renderCard({ cardCount: 0, doneCount: 0 });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.getByText('Chưa có thẻ')).toBeInTheDocument();
  });

  it('thiếu dữ liệu tùy chọn thì ẩn chứ không thay bằng số 0', () => {
    renderCard({ cardCount: undefined, doneCount: undefined, memberCount: undefined, workspaceName: undefined });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(screen.queryByText(/thành viên/)).not.toBeInTheDocument();
    expect(screen.queryByText('Chưa có thẻ')).not.toBeInTheDocument();
    expect(screen.queryByText(/thẻ hoàn thành/)).not.toBeInTheDocument();
  });

  it('chỉ có workspace (không có số thành viên) thì chỉ hiện tên workspace', () => {
    renderCard({ memberCount: undefined });
    expect(screen.getByText('Nhóm Website bán hàng')).toBeInTheDocument();
  });

  it('showWorkspace=false (thẻ nằm dưới tiêu đề không gian): chỉ hiện số thành viên', () => {
    render(
      <MemoryRouter>
        <BoardCard
          board={BASE}
          showWorkspace={false}
          onChanged={vi.fn()}
          onRequestDelete={vi.fn()}
          onToggleStar={vi.fn()}
        />
      </MemoryRouter>
    );
    expect(screen.getByText('5 thành viên')).toBeInTheDocument();
    expect(screen.queryByText(/Nhóm Website bán hàng/)).not.toBeInTheDocument();
  });

  it('hiện ngày cập nhật bảng', () => {
    renderCard();
    expect(screen.getByTitle('Ngày cập nhật bảng')).toHaveTextContent(/Cập nhật \d{2}[/-]\d{2}/);
  });

  it('nút tuỳ chọn bảng vẫn có tên truy cập', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Tuỳ chọn bảng' })).toBeInTheDocument();
  });
});
