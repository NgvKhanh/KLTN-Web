import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ErrorBoundary from './ErrorBoundary';

// React in ra console.error khi boundary bat loi: tat de ket qua test sach, nhung van kiem tra duoc da ghi log
let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

let shouldThrow = true;
function Bomb() {
  if (shouldThrow) throw new Error('dung giao dien hong');
  return <p>noi dung binh thuong</p>;
}

describe('ErrorBoundary', () => {
  it('khong co loi -> hien noi dung nhu cu', () => {
    shouldThrow = false;
    render(
      <ErrorBoundary scope="test">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText('noi dung binh thuong')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('con ne loi luc render -> hien khung thong bao, phan ngoai boundary van song, loi duoc ghi log', () => {
    shouldThrow = true;
    render(
      <div>
        <nav>thanh dieu huong</nav>
        <ErrorBoundary scope="page">
          <Bomb />
        </ErrorBoundary>
      </div>
    );
    expect(screen.getByRole('alert')).toHaveTextContent('gặp lỗi khi hiển thị');
    expect(screen.getByText('thanh dieu huong')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Về trang chủ' })).toHaveAttribute('href', '/');
    expect(errorSpy.mock.calls.some((call: unknown[]) => String(call[0]).includes('ErrorBoundary: page'))).toBe(true);
  });

  it('"Thu lai" dung lai noi dung sau khi nguyen nhan da het', async () => {
    shouldThrow = true;
    render(
      <ErrorBoundary scope="test">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    shouldThrow = false;
    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }));
    expect(screen.getByText('noi dung binh thuong')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('resetKey doi (sang trang khac) -> tu thoat khoi trang thai loi', () => {
    shouldThrow = true;
    const { rerender } = render(
      <ErrorBoundary scope="page" resetKey="/boards/a">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    shouldThrow = false;
    rerender(
      <ErrorBoundary scope="page" resetKey="/boards/b">
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText('noi dung binh thuong')).toBeInTheDocument();
  });

  it('fallback tuy chinh duoc dung; fallback tra null -> vung bien mat, khong lam hong trang', () => {
    shouldThrow = true;
    const { container, rerender } = render(
      <ErrorBoundary scope="card-modal" fallback={({ error }) => <p>that bai: {error.message}</p>}>
        <Bomb />
      </ErrorBoundary>
    );
    expect(screen.getByText('that bai: dung giao dien hong')).toBeInTheDocument();

    rerender(
      <ErrorBoundary scope="assistant" resetKey="x" fallback={() => null}>
        <Bomb />
      </ErrorBoundary>
    );
    // resetKey doi (undefined -> "x") nen thu dung lai, Bomb van ne -> roi vao fallback null
    expect(container).toBeEmptyDOMElement();
  });
});
