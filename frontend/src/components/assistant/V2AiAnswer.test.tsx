import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { AssistantTurn } from '../../context/AssistantContext';
import type { ChatReply, ChatV2Block } from '../../types/chat';
import V2AnswerView from './V2AnswerView';

// Buoc C: doan tra loi tu do cua AI. Chi hien khi backend da kiem so / ten (answer.aiAnswer); luon ghi ro la AI va noi no dung du lieu nao.

const source = { id: 's1', generatedAt: '2026-10-07T03:00:00.000Z', scope: { kind: 'MY' as const }, scopeLabel: 'Các bảng bạn được phép xem', appliedInput: {}, ranges: [] };
const okBlock = { id: 'b1', title: 'Danh mục', status: 'OK', tool: 'query_catalog', source, pagination: { page: 1, hasMore: false }, data: { kind: 'MEMBERS', total: 0, page: 1, pageSize: 20, hasMore: false, rows: [] } } as unknown as ChatV2Block;

function renderAnswer(answer: Record<string, unknown>) {
  const reply = { conversationId: 'c', mode: 'AI', understood: {}, answer: { kind: 'ANSWER', text: 'Kết quả từ dữ liệu bạn được phép xem:', blocks: [], notes: [], ...answer } } as unknown as ChatReply;
  const turn = { id: 1, question: 'q', status: 'done', reply, cards: [], page: 1, error: null, loadingMore: false, moreError: null, actionBusy: false, actionError: null } as unknown as AssistantTurn;
  render(<MemoryRouter><V2AnswerView turn={turn} latest busy={false} scope={{ kind: 'MY' }} onMore={vi.fn()} onChoose={vi.fn()} onConfirm={vi.fn()} onCancel={vi.fn()} /></MemoryRouter>);
}

describe('đoạn trả lời tự do của AI', () => {
  it('hiện trong khung riêng có nhãn AI thay cho dòng mặc định, kèm lời nhắc đã đối chiếu với khối dữ liệu', () => {
    renderAnswer({ text: 'Có 7 việc.', aiAnswer: { text: 'Có 7 việc.\n- Nguyễn Lan: 3 việc', source: 'AI' }, blocks: [okBlock] });
    const box = screen.getByRole('region', { name: 'Trả lời của trợ lý (AI)' });
    expect(box).toHaveTextContent('Có 7 việc.');
    expect(box).toHaveTextContent('- Nguyễn Lan: 3 việc');
    expect(box).toHaveTextContent('Số liệu và tên đã được đối chiếu với dữ liệu tra cứu bên dưới.');
    expect(screen.queryByText('Kết quả từ dữ liệu bạn được phép xem:')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Danh mục' })).toBeInTheDocument();
  });

  it('không có khối dữ liệu (chào hỏi, giới thiệu): nói rõ đây là câu trả lời chung, không dùng dữ liệu công việc', () => {
    renderAnswer({ kind: 'ANSWER', text: 'Chào bạn!', aiAnswer: { text: 'Chào bạn! Mình giúp tra cứu công việc.', source: 'AI' }, blocks: [] });
    expect(within(screen.getByRole('region', { name: 'Trả lời của trợ lý (AI)' })).getByText('Đây là câu trả lời chung, không dùng dữ liệu công việc.')).toBeInTheDocument();
  });

  it('văn bản của AI là chữ thuần: thẻ HTML không được dựng', () => {
    renderAnswer({ aiAnswer: { text: '<img src=x onerror=alert(1)> xin chào', source: 'AI' } });
    const box = screen.getByRole('region', { name: 'Trả lời của trợ lý (AI)' });
    expect(box.querySelector('img')).toBeNull();
    expect(box).toHaveTextContent('<img src=x onerror=alert(1)> xin chào');
  });

  it('không có aiAnswer: giữ nguyên dòng mặc định như trước', () => {
    renderAnswer({ blocks: [okBlock] });
    expect(screen.getByText('Kết quả từ dữ liệu bạn được phép xem:')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Trả lời của trợ lý (AI)' })).not.toBeInTheDocument();
  });
});
