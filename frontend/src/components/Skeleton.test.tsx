import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, SkeletonBoardGrid, SkeletonColumns, SkeletonRegion, SkeletonRows } from './Skeleton';

describe('Skeleton', () => {
  it('vùng đang tải báo cho trình đọc màn hình bằng role=status, aria-busy và câu mô tả', () => {
    render(
      <SkeletonRegion label="Đang tải danh sách bảng…">
        <Skeleton />
      </SkeletonRegion>
    );
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(region).toHaveTextContent('Đang tải danh sách bảng…');
  });

  it('các khối chờ chỉ để trang trí nên ẩn với trình đọc màn hình (không tạo nội dung thừa)', () => {
    const { container } = render(
      <SkeletonRegion label="Đang tải">
        <SkeletonRows rows={3} />
        <SkeletonBoardGrid count={5} />
        <SkeletonColumns columns={2} />
      </SkeletonRegion>
    );
    const blocks = container.querySelectorAll('.tf-skeleton');
    expect(blocks.length).toBeGreaterThan(10);
    for (const b of blocks) expect(b).toHaveAttribute('aria-hidden', 'true');
    // Chữ duy nhất mà trình đọc màn hình đọc được là câu mô tả
    expect(screen.getByRole('status').textContent).toBe('Đang tải');
  });

  it('lưới bảng chờ có đúng số khối được yêu cầu', () => {
    const { container } = render(<SkeletonBoardGrid count={6} />);
    expect(container.querySelectorAll('.tf-skeleton')).toHaveLength(6);
  });

  it('đặt trên nền màu của bảng thì dùng biến thể onColor', () => {
    const { container } = render(<SkeletonColumns columns={1} onColor />);
    const blocks = [...container.querySelectorAll('.tf-skeleton')];
    expect(blocks.length).toBeGreaterThan(0);
    expect(blocks.every((b) => b.classList.contains('tf-skeleton-on-color'))).toBe(true);
  });
});
