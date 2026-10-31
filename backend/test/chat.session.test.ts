// Kho phien hoi thoai trong bo nho (CHATBOT_MODULE.md §9.1). Ham thuan: dong ho truyen vao.
import { describe, expect, it } from 'vitest';
import {
  ChatSessionStore,
  MAX_SESSIONS_PER_USER,
  MAX_SESSIONS_TOTAL,
  SESSION_TTL_MS,
  chatSessions,
  scopeKeyOf,
} from '../src/modules/chat/chat.session';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('ChatSessionStore', () => {
  it('gan voi nguoi dung, het han theo thoi gian khong hoat dong, cham vao thi gia han', () => {
    const store = new ChatSessionStore({ ttlMs: 1000, maxPerUser: 5, maxTotal: 100 });
    const a = store.create('u1', 'MY', 0);
    const b = store.create('u1', 'MY', 0);
    expect(a.id).toMatch(UUID);
    expect(a.id).not.toBe(b.id);
    expect(store.get(a.id, 'u1', 10)).toBe(a.state);
    // nguoi khac dung ma nay: khong thay gi, nhung phien cua chu van con
    expect(store.get(a.id, 'u2', 20)).toBeNull();
    expect(store.get(a.id, 'u1', 30)).toBe(a.state);
    expect(store.get('khong-co', 'u1', 30)).toBeNull();

    // han tinh tu lan dung CUOI: 30 + 1000 van con, 30 + 1001 het
    expect(store.get(a.id, 'u1', 1030)).toBe(a.state);
    expect(store.get(a.id, 'u1', 2031)).toBeNull();
    expect(store.get(a.id, 'u1', 2031)).toBeNull(); // da xoa, khong "song lai"
    expect(store.size()).toBe(1); // b chua bi quet (chi quet khi tao moi)
    store.create('u3', 'MY', 5000); // tao moi -> quet phien het han
    expect(store.size()).toBe(1);
    expect(store.get(b.id, 'u1', 5000)).toBeNull();

    // trang thai khoi tao va phien doc lap voi nhau
    const c = store.create('u1', 'WORKSPACE:w1', 6000);
    expect(c.state).toEqual({ userId: 'u1', scopeKey: 'WORKSPACE:w1', context: null, pending: null, lastQuery: null, lastUsedAt: 6000 });
    const d = store.create('u1', 'MY', 6000);
    c.state.context = { intent: 'MY_TASKS', period: null, focus: null, memberUserId: null };
    expect(d.state.context).toBeNull();
  });

  it('gioi han so phien moi nguoi va toan tien trinh: bo phien dung lau nhat', () => {
    const store = new ChatSessionStore({ ttlMs: 1_000_000, maxPerUser: 3, maxTotal: 5 });
    const s1 = store.create('u1', 'MY', 1);
    const s2 = store.create('u1', 'MY', 2);
    const s3 = store.create('u1', 'MY', 3);
    store.get(s1.id, 'u1', 4); // s1 vua duoc dung -> s2 la cu nhat
    const s4 = store.create('u1', 'MY', 5);
    expect(store.get(s2.id, 'u1', 6)).toBeNull();
    expect(store.size()).toBe(3);
    // dung lai theo thu tu s1 (6) < s3 (7) < s4 (8)
    expect(store.get(s1.id, 'u1', 6)).not.toBeNull();
    expect(store.get(s3.id, 'u1', 7)).not.toBeNull();
    expect(store.get(s4.id, 'u1', 8)).not.toBeNull();

    const o1 = store.create('u2', 'MY', 9);
    const o2 = store.create('u3', 'MY', 10); // tong = 5
    expect(store.size()).toBe(5);
    const o3 = store.create('u4', 'MY', 11); // vuot tong -> bo phien dung lau nhat toan kho: s1 (6)
    expect(store.size()).toBe(5);
    expect(store.get(s1.id, 'u1', 12)).toBeNull();
    for (const [s, u] of [[s3, 'u1'], [s4, 'u1'], [o1, 'u2'], [o2, 'u3'], [o3, 'u4']] as const) {
      expect(store.get(s.id, u, 12), u).not.toBeNull();
    }
  });

  it('khoa pham vi va hang so mac dinh', () => {
    expect(scopeKeyOf({ kind: 'MY' })).toBe('MY');
    expect(scopeKeyOf({ kind: 'WORKSPACE', workspaceId: 'w1' })).toBe('WORKSPACE:w1');
    expect(scopeKeyOf({ kind: 'BOARD', boardId: 'b1' })).toBe('BOARD:b1');
    expect([SESSION_TTL_MS, MAX_SESSIONS_PER_USER, MAX_SESSIONS_TOTAL]).toEqual([30 * 60 * 1000, 5, 2000]);
    // kho dung chung dung dung cac gioi han mac dinh
    const t = 1_000_000_000;
    const s = chatSessions.create('mac-dinh', 'MY', t);
    expect(chatSessions.get(s.id, 'mac-dinh', t + SESSION_TTL_MS)).not.toBeNull();
    expect(chatSessions.get(s.id, 'mac-dinh', t + 2 * SESSION_TTL_MS + 1)).toBeNull();
  });
});
