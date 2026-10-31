import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import CardConflictDialog, { type ConflictRow } from './CardConflictDialog';

const ROWS: ConflictRow[] = [
  { key: 'description', label: 'Mô tả', mine: 'Bản của tôi', theirs: 'Bản của Mai' },
];

function setup(over: Partial<Parameters<typeof CardConflictDialog>[0]> = {}) {
  const onOverwrite = vi.fn();
  const onUseTheirs = vi.fn();
  const onKeepEditing = vi.fn();
  render(
    <CardConflictDialog
      rows={ROWS}
      busy={false}
      onOverwrite={onOverwrite}
      onUseTheirs={onUseTheirs}
      onKeepEditing={onKeepEditing}
      {...over}
    />
  );
  return { onOverwrite, onUseTheirs, onKeepEditing, user: userEvent.setup() };
}

describe('CardConflictDialog', () => {
  it('hien ban cua minh canh ban moi tren the', () => {
    setup();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText('Bản của tôi')).toBeInTheDocument();
    expect(screen.getByText('Bản của Mai')).toBeInTheDocument();
  });

  it('3 nut goi dung 3 hanh dong', async () => {
    const { user, onOverwrite, onUseTheirs, onKeepEditing } = setup();
    await user.click(screen.getByRole('button', { name: 'Sửa tiếp' }));
    await user.click(screen.getByRole('button', { name: 'Dùng bản mới trên thẻ' }));
    await user.click(screen.getByRole('button', { name: 'Ghi đè bằng bản của tôi' }));
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    expect(onUseTheirs).toHaveBeenCalledTimes(1);
    expect(onOverwrite).toHaveBeenCalledTimes(1);
  });

  it('Esc = Sua tiep (khong lam mat noi dung dang viet)', async () => {
    const { user, onKeepEditing, onOverwrite, onUseTheirs } = setup();
    await user.keyboard('{Escape}');
    expect(onKeepEditing).toHaveBeenCalledTimes(1);
    expect(onOverwrite).not.toHaveBeenCalled();
    expect(onUseTheirs).not.toHaveBeenCalled();
  });

  it('khong co "Sua tiep" (xung dot ngay thang): an nut va Esc = dung ban moi', async () => {
    const { user, onUseTheirs } = setup({ onKeepEditing: undefined });
    expect(screen.queryByRole('button', { name: 'Sửa tiếp' })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onUseTheirs).toHaveBeenCalledTimes(1);
  });

  it('dang luu (busy): khoa ca 3 nut', () => {
    setup({ busy: true });
    for (const b of screen.getAllByRole('button')) expect(b).toBeDisabled();
  });

  it('truong trong hien "(trống)"', () => {
    setup({ rows: [{ key: 'dueDate', label: 'Ngày hết hạn', mine: '', theirs: '10:00 20/10/2026' }] });
    expect(screen.getByText('(trống)')).toBeInTheDocument();
  });
});
