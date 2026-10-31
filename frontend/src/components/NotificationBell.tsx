import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllNotificationsRead,
  markNotificationRead,
} from '../lib/api/notification';
import { initialsOf } from '../lib/avatar';
import { logError } from '../lib/logError';
import { socket } from '../lib/socket';
import type { AppNotification } from '../types/notification';
import { SkeletonRegion, SkeletonRows } from './Skeleton';

const AVATAR_COLORS = [
  '#0079BF',
  '#D29034',
  '#519839',
  '#B04632',
  '#89609E',
  '#CD5A91',
  '#00AECC',
  '#4BBF6B',
];
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i += 1)
    h = (h * 31 + id.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h)]!;
}

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'vừa xong';
  if (s < 3600) return `${Math.floor(s / 60)} phút trước`;
  if (s < 86400) return `${Math.floor(s / 3600)} giờ trước`;
  if (s < 604800) return `${Math.floor(s / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

function notifText(n: AppNotification): string {
  const a = n.actor.name;
  const d = n.data;
  switch (n.type) {
    case 'board.member.added':
      return `${a} đã thêm bạn vào bảng "${d.boardName}"`;
    case 'board.member.removed':
      return `${a} đã xoá bạn khỏi bảng "${d.boardName}"`;
    case 'board.role.changed':
      return `${a} đã đổi vai trò của bạn thành ${
        d.role === 'ADMIN'
          ? 'Quản trị viên'
          : d.role === 'VIEWER'
            ? 'Người xem'
            : 'Thành viên'
      } ở bảng "${d.boardName}"`;
    case 'board.ownership.transferred':
      return `${a} đã chuyển quyền sở hữu bảng "${d.boardName}" cho bạn`;
    case 'workspace.member.added':
      return `${a} đã thêm bạn vào không gian "${d.workspaceName}"`;
    case 'workspace.member.removed':
      return `${a} đã xoá bạn khỏi không gian "${d.workspaceName}"`;
    case 'workspace.role.changed':
      return `${a} đã đổi vai trò của bạn thành ${
        d.role === 'ADMIN' ? 'Quản trị viên' : 'Thành viên'
      } ở không gian "${d.workspaceName}"`;
    case 'workspace.ownership.transferred':
      return `${a} đã chuyển quyền sở hữu không gian "${d.workspaceName}" cho bạn`;
    case 'board.join.request':
      return `${a} muốn tham gia bảng "${d.boardName}"`;
    case 'board.join.approved':
      return `${a} đã chấp nhận bạn vào bảng "${d.boardName}"`;
    case 'board.join.rejected':
      return `${a} đã từ chối yêu cầu tham gia bảng "${d.boardName}"`;
    case 'card.member.added':
      return `${a} đã thêm bạn vào thẻ "${d.cardTitle}"`;
    case 'card.comment':
      return `${a} đã bình luận thẻ "${d.cardTitle}": ${d.text}`;
    case 'card.mentioned':
      return `${a} đã nhắc đến bạn trong thẻ "${d.cardTitle}": ${d.text}`;
    case 'card.comment.reply':
      return `${a} đã trả lời bình luận của bạn trong thẻ "${d.cardTitle}": ${d.text}`;
    case 'card.attachment.added':
      return `${a} đã đính kèm "${d.name}" vào thẻ "${d.cardTitle}"`;
    case 'card.moved':
      return `${a} đã chuyển thẻ "${d.cardTitle}" sang ${d.toList}`;
    case 'card.renamed':
      return `${a} đã đổi tên thẻ thành "${d.cardTitle}"`;
    case 'card.due.set':
      return `${a} đã đặt ngày hết hạn cho thẻ "${d.cardTitle}"`;
    case 'card.due.reminder':
      return `Sắp đến hạn thẻ "${d.cardTitle}" — còn ${d.offsetLabel} nữa`;
    case 'card.risk.warning': {
      // Chi 2 loai cau, khong muc, khong phan tram (user chot 30/10). Thong bao cu chua co `kind`: suy tu luc bao so voi han.
      const late = d.kind ? d.kind === 'overdue' : Boolean(d.dueDate) && Date.parse(n.createdAt) > Date.parse(d.dueDate);
      return late ? `Thẻ "${d.cardTitle}" đã trễ hạn` : `Thẻ "${d.cardTitle}" có nguy cơ trễ hạn`;
    }
    case 'card.marked.done':
      return `${a} đã đánh dấu hoàn thành thẻ "${d.cardTitle}"`;
    case 'card.deleted':
      return `${a} đã xoá thẻ "${d.cardTitle}"`;
    default:
      return `${a}: ${n.type}`;
  }
}

export default function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadOnly, setUnreadOnly] = useState(true);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    fetchUnreadCount()
      .then(setCount)
      .catch(logError('NotificationBell: dem chua doc'));
  }, []);

  // Hoi so chua doc luc dau + moi 45 giay (du phong khi socket roi)
  useEffect(() => {
    refreshCount();
    const t = setInterval(refreshCount, 45000);
    return () => clearInterval(t);
  }, [refreshCount]);

  const load = useCallback(() => {
    setLoading(true);
    fetchNotifications(unreadOnly)
      .then(setItems)
      .catch(logError('NotificationBell: tai thong bao'))
      .finally(() => setLoading(false));
  }, [unreadOnly]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Realtime: co thong bao moi -> cap nhat so + danh sach ngay
  useEffect(() => {
    const onNew = () => {
      refreshCount();
      load();
    };
    socket.on('notification:new', onNew);
    return () => {
      socket.off('notification:new', onNew);
    };
  }, [refreshCount, load]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function openItem(n: AppNotification) {
    if (!n.isRead) {
      setItems((cur) =>
        cur.map((x) => (x.id === n.id ? { ...x, isRead: true } : x))
      );
      setCount((c) => Math.max(0, c - 1));
      void markNotificationRead(n.id);
    }
    if (n.boardId) {
      setOpen(false);
      // Yeu cau tham gia -> mo thang tab "Yeu cau tham gia" trong panel Chia se
      // Co the -> mo thang the lien quan
      const suffix =
        n.type === 'board.join.request'
          ? '?share=requests'
          : n.cardId
            ? `?card=${n.cardId}`
            : '';
      navigate(`/boards/${n.boardId}${suffix}`);
    } else if (n.workspaceId) {
      setOpen(false);
      navigate(`/workspaces/${n.workspaceId}`);
    }
  }

  async function markAll() {
    setItems((cur) => cur.map((x) => ({ ...x, isRead: true })));
    setCount(0);
    await markAllNotificationsRead();
    load();
  }

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Thông báo"
        className="relative grid h-8 w-8 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M18 8a6 6 0 00-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 01-3.4 0" />
        </svg>
        {count > 0 && (
          <span className="absolute -right-0.5 -top-0.5 grid min-w-[16px] place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open &&
        createPortal(
          <div
            className="tf-menu-in fixed right-3 top-14 z-50 w-[380px] max-w-[92vw] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3">
              <h3 className="flex-1 text-base font-semibold text-slate-800">
                Thông báo
              </h3>
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Chỉ hiển thị chưa đọc
                <input
                  type="checkbox"
                  checked={unreadOnly}
                  onChange={(e) => setUnreadOnly(e.target.checked)}
                  className="h-4 w-4"
                />
              </label>
              <button
                type="button"
                onClick={markAll}
                title="Đánh dấu tất cả đã đọc"
                className="rounded p-1 text-slate-400 hover:bg-slate-100"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <circle cx="5" cy="12" r="1.6" />
                  <circle cx="12" cy="12" r="1.6" />
                  <circle cx="19" cy="12" r="1.6" />
                </svg>
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <SkeletonRegion label="Đang tải thông báo…" className="px-4 py-4">
                  <SkeletonRows rows={4} />
                </SkeletonRegion>
              ) : items.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-500">
                  {unreadOnly
                    ? 'Không có Thông báo chưa đọc'
                    : 'Chưa có thông báo nào'}
                </p>
              ) : (
                <ul>
                  {items.map((n) => (
                    <li key={n.id}>
                      <button
                        type="button"
                        onClick={() => openItem(n)}
                        className={`flex w-full gap-3 border-b border-slate-100 px-4 py-3 text-left hover:bg-slate-50 ${
                          n.isRead ? '' : 'bg-primary/[0.04]'
                        }`}
                      >
                        <span
                          className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: avatarColor(n.actor.id) }}
                        >
                          {initialsOf(n.actor.name)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-slate-700">
                            {notifText(n)}
                          </span>
                          <span className="mt-0.5 block text-xs text-slate-400">
                            {timeAgo(n.createdAt)}
                          </span>
                        </span>
                        {!n.isRead && (
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
