import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BoardVisibilityMenu from './BoardVisibilityMenu';

describe('BoardVisibilityMenu', () => {
  it('có đủ 3 mức: Riêng tư, Không gian làm việc, Công khai', () => {
    render(
      <BoardVisibilityMenu
        value="WORKSPACE"
        onChange={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText('Riêng tư')).toBeInTheDocument();
    expect(screen.getByText('Không gian làm việc')).toBeInTheDocument();
    expect(screen.getByText('Công khai')).toBeInTheDocument();
  });
});
