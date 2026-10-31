import { api } from '../axios';
import type { ChatConversationHistory, ChatConversationList, ChatReply, ChatScope, ChatStagedFile, ChatStatus } from '../../types/chat';

// Lop goi API cua tro ly (CHATBOT_MODULE.md §12). Client CHI gui cau hoi, pham vi va ma hoi
// thoai - khong bao gio gui vai tro, danh tinh hay id nguoi duoc nhac (server tu kiem quyen).

// Discover the server-selected engine; availability means configured, not a live key check.
export async function fetchChatStatus(): Promise<ChatStatus> {
  const res = await api.get<{ data: ChatStatus }>('/chat/v2/status');
  return res.data.data;
}

export async function fetchChatConversations(page = 1): Promise<ChatConversationList> {
  const res = await api.get<{ data: ChatConversationList }>('/chat/v2/conversations', { params: { page } });
  return res.data.data;
}
export async function fetchChatConversation(id: string, before?: number): Promise<ChatConversationHistory> {
  const res = await api.get<{ data: ChatConversationHistory }>(`/chat/v2/conversations/${encodeURIComponent(id)}`, { params: before ? { before } : {} });
  return res.data.data;
}

// POST /api/chat/messages - hoi mot cau.
export async function sendChatMessage(input: {
  message: string;
  scope: ChatScope;
  conversationId?: string;
  /** v2: id cac tep da tai len (uploadChatFile) de dinh kem vao tin nhan nay. */
  uploadIds?: string[];
}, engine: 'legacy' | 'v2' = 'legacy'): Promise<ChatReply> {
  const body = {
    message: input.message,
    scope: input.scope,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(engine === 'v2' && input.uploadIds && input.uploadIds.length > 0 ? { uploadIds: input.uploadIds } : {}),
  };
  const res = await api.post<{ data: ChatReply }>(engine === 'v2' ? '/chat/v2/messages' : '/chat/messages', body);
  return res.data.data;
}

// Answer an entity clarification. v2 may replan with AI after rechecking the chosen entity.
// Gui DUNG MOT trong userId / workspaceId / targetId theo loai lua chon.
// `scope` (v2, tuy chon): pham vi giao dien HIEN TAI khi dang o trang bang - nut cua mot luot cu o trang khac se bi tu choi (409).
export async function sendChatChoice(
  conversationId: string,
  option: { kind: 'USER' | 'WORKSPACE' | 'TARGET'; id: string },
  engine: 'legacy' | 'v2' = 'legacy',
  scope?: ChatScope
): Promise<ChatReply> {
  const body =
    option.kind === 'USER'
      ? { conversationId, userId: option.id }
      : option.kind === 'WORKSPACE'
        ? { conversationId, workspaceId: option.id }
        : { conversationId, targetId: option.id };
  const res = await api.post<{ data: ChatReply }>(engine === 'v2' ? '/chat/v2/messages/choice' : '/chat/messages/choice', engine === 'v2' ? { conversationId, optionId: option.id, ...(scope ? { scope } : {}) } : body);
  return res.data.data;
}

// Next page of a server-owned query (v2: one block). Never calls AI.
export async function fetchMoreAnswer(conversationId: string, page: number, blockId?: string, engine: 'legacy' | 'v2' = 'legacy', scope?: ChatScope): Promise<ChatReply> {
  const res = await api.post<{ data: ChatReply }>(engine === 'v2' ? '/chat/v2/messages/more' : '/chat/messages/more', { conversationId, page, ...(blockId ? { blockId } : {}), ...(engine === 'v2' && scope ? { scope } : {}) });
  return res.data.data;
}

// Nut "Ap dung" cua ban xem truoc (v2, khong goi AI). Gui lai checksum cua chinh ban xem truoc va pham vi giao dien HIEN TAI:
// ke hoach cua bang khac voi trang dang mo bi huy. Tra loi co answer.action.kind = 'RESULT'.
export async function confirmChatAction(plan: { planId: string; checksum: string }, conversationId: string, scope: ChatScope): Promise<ChatReply> {
  const res = await api.post<{ data: ChatReply }>(`/chat/v2/actions/${encodeURIComponent(plan.planId)}/confirm`, { conversationId, checksum: plan.checksum, scope });
  return res.data.data;
}

// Tai mot tep len kho tam cua tro ly (chua gan vao the nao: chi gan khi nguoi dung ra lenh va bam Ap dung). Toi da 10 MB.
export async function uploadChatFile(file: File): Promise<ChatStagedFile> {
  const form = new FormData();
  form.append('file', file);
  const res = await api.post<{ data: ChatStagedFile }>('/chat/v2/uploads', form);
  return res.data.data;
}

// Bo mot tep tam (nut x).
export async function discardChatUpload(id: string): Promise<void> {
  await api.delete(`/chat/v2/uploads/${encodeURIComponent(id)}`);
}

// Nut "Huy" cua ban xem truoc.
export async function cancelChatAction(planId: string, conversationId: string): Promise<ChatReply> {
  const res = await api.post<{ data: ChatReply }>(`/chat/v2/actions/${encodeURIComponent(planId)}/cancel`, { conversationId });
  return res.data.data;
}
