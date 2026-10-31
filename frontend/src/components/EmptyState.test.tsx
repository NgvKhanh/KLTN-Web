import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import EmptyState from './EmptyState';

describe('EmptyState', () => {
  it('hiện tiêu đề và mô tả; biểu tượng chỉ để trang trí (ẩn với trình đọc màn hình)', () => {
    const { container } = render(
      <EmptyState icon="tasks" title="Bạn chưa được gán vào thẻ nào." description="Thẻ được giao sẽ hiện ở đây." />
    );
    expect(screen.getByText('Bạn chưa được gán vào thẻ nào.')).toBeInTheDocument();
    expect(screen.getByText('Thẻ được giao sẽ hiện ở đây.')).toBeInTheDocument();
    expect(container.querySelector('svg')?.parentElement).toHaveAttribute('aria-hidden', 'true');
  });

  it('có hành động thì hiển thị hành động đó', () => {
    render(<EmptyState icon="boards" title="Chưa có bảng" action={<a href="/boards">Tạo bảng đầu tiên</a>} />);
    expect(screen.getByRole('link', { name: 'Tạo bảng đầu tiên' })).toHaveAttribute('href', '/boards');
  });

  it('không có mô tả thì không tạo đoạn mô tả rỗng', () => {
    const { container } = render(<EmptyState icon="search" title="Không có kết quả" />);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });
});
