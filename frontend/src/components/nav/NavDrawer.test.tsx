import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NavDrawer from './NavDrawer';

let mqListener: (() => void) | null = null;
let mqMatches = false;

beforeEach(() => {
  mqListener = null;
  mqMatches = false;
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return mqMatches;
    },
    media: '(min-width: 768px)',
    addEventListener: (_: string, fn: () => void) => {
      mqListener = fn;
    },
    removeEventListener: () => {
      mqListener = null;
    },
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <MemoryRouter>
      <button onClick={() => setOpen(true)}>Mở điều hướng</button>
      <NavDrawer open={open} onClose={() => setOpen(false)} label="Điều hướng">
        <a href="/a">Liên kết A</a>
        <button>Nút B</button>
      </NavDrawer>
    </MemoryRouter>
  );
}

describe('NavDrawer', () => {
  it('đóng thì không có gì trên trang', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('mở thì là hộp thoại có tên, aria-modal, và focus chuyển vào trong ngăn', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mở điều hướng' }));
    const dialog = screen.getByRole('dialog', { name: 'Điều hướng' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(screen.getByRole('button', { name: 'Đóng điều hướng' })).toHaveFocus();
  });

  it('Escape đóng ngăn và trả focus về nút đã mở', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Mở điều hướng' });
    await user.click(opener);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it('bấm nền tối đóng ngăn', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mở điều hướng' }));
    const backdrop = document.querySelector('.tf-drawer-backdrop') as HTMLElement;
    await user.click(backdrop);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('chọn một liên kết thì ngăn đóng; bấm nút thường thì không', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mở điều hướng' }));
    await user.click(screen.getByRole('button', { name: 'Nút B' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Liên kết A' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('Tab giữ trong ngăn: từ phần tử cuối quay về đầu, Shift+Tab từ đầu ra cuối', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mở điều hướng' }));
    const close = screen.getByRole('button', { name: 'Đóng điều hướng' });
    const last = screen.getByRole('button', { name: 'Nút B' });
    last.focus();
    await user.tab();
    expect(close).toHaveFocus();
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
  });

  it('phím bấm trong ngăn không lọt ra document (không kích hoạt phím tắt phía sau)', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mở điều hướng' }));
    const spy = vi.fn();
    document.addEventListener('keydown', spy);
    await user.keyboard('n');
    await user.keyboard('/');
    document.removeEventListener('keydown', spy);
    expect(spy).not.toHaveBeenCalled();
  });

  it('màn hình rộng ra tới desktop thì tự đóng', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Mở điều hướng' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    mqMatches = true;
    mqListener?.();
    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });
});
