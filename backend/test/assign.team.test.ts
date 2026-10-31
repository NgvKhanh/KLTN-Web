// Nhom demo 5 nguoi (teamSeed.ts): du lieu do TAY cho phan goi y phan cong. Chay tren DB TEST.
//
// Ba loai bao dam:
//  (1) du lieu soan tay NHAT QUAN (khong ai duoc giao viec truoc khi vao nhom, dung so lieu da thiet ke);
//  (2) ghi xuong CSDL dung va AN TOAN (chay lai khong nhan doi, khong dung toi nguoi that / du lieu @sim.local);
//  (3) chay qua BO CHAM THAT (suggestForCard / planForList) cho ra dung "cau chuyen" ma du lieu duoc soan de ke:
//      moi nguoi la ung vien tot nhat o it nhat mot viec, nguoi qua tai bi gan co, nguoi moi bi danh dau du lieu mong.
import { describe, expect, it } from 'vitest';
import { prisma } from '../src/config/prisma';
import { planForList, suggestForCard, type Suggestion } from '../src/modules/assign/assign.service';
import { simDayToDate } from '../src/scripts/simSeed';
import {
  TEAM_BOARDS,
  TEAM_EMAIL_DOMAIN,
  TEAM_PASSWORD,
  TEAM_PEOPLE,
  TEAM_WORKSPACE_NAME,
  expandTeamCards,
  removeTeam,
  seedTeam,
} from '../src/scripts/teamSeed';
import { agent, makeDirectUser } from './helpers';

const TODAY = '2026-09-20';
const NOW = simDayToDate(TODAY, 0, 0, 12); // 12:00 trua gio VN hom nay
const DESIGN = expandTeamCards();
const teamUsers = () => prisma.user.count({ where: { email: { endsWith: `@${TEAM_EMAIL_DOMAIN}` } } });

describe('nhom demo - du lieu soan tay nhat quan (ham thuan, khong DB)', () => {
  it('so luong dung thiet ke; khoa duy nhat; khong ai duoc giao viec truoc khi vao nhom; han = xong - tre', () => {
    const done = DESIGN.filter((c) => c.completedAgo !== null);
    const open = DESIGN.filter((c) => c.assigneeKey !== null && c.completedAgo === null);
    const todo = DESIGN.filter((c) => c.assigneeKey === null);
    expect([done.length, open.length, todo.length]).toEqual([48, 9, 7]);
    expect(new Set(DESIGN.map((c) => c.key)).size).toBe(DESIGN.length);

    for (const c of DESIGN) {
      if (c.assigneeKey === null) continue;
      const p = TEAM_PEOPLE.find((x) => x.key === c.assigneeKey)!;
      expect(c.assignedAgo!, `${c.key} duoc giao truoc khi ${p.name} vao nhom`).toBeLessThanOrEqual(p.joinedAgo);
      expect(c.createdAgo, c.key).toBe(c.assignedAgo! + 1);
      expect(c.dueAgo!, `${c.key} co han truoc ngay bat dau`).toBeLessThan(c.assignedAgo!);
      // Viec da xong: bat dau = han - 5 ngay (viec dang mo co cua so rieng do nguoi soan dat)
      if (c.completedAgo !== null) expect(c.assignedAgo! - c.dueAgo!, c.key).toBe(5);
    }
    // Viec chua giao nam o cot "Can lam" cua sprint dang chay, viec dang mo o cot "Dang lam", viec xong o "Hoan thanh"
    const last = TEAM_BOARDS.length - 1;
    expect(todo.every((c) => c.boardIndex === last && c.listIndex === 0)).toBe(true);
    expect(open.every((c) => c.boardIndex === last && c.listIndex === 1 && c.dueAgo! < 0)).toBe(true);
    expect(done.every((c) => c.listIndex === 2)).toBe(true);
  });

  it('ti le dung han va tai hien tai tung nguoi dung nhu da thiet ke', () => {
    const stat = (key: string) => {
      const mine = DESIGN.filter((c) => c.assigneeKey === key);
      const done = mine.filter((c) => c.completedAgo !== null);
      // Xong cach day N ngay, han cach day M ngay: dung han khi xong khong sau han (N >= M)
      const onTime = done.filter((c) => c.completedAgo! >= c.dueAgo!).length;
      return { done: done.length, onTime, open: mine.length - done.length };
    };
    expect(stat('long')).toEqual({ done: 14, onTime: 12, open: 2 });
    expect(stat('mai')).toEqual({ done: 12, onTime: 10, open: 4 }); // 4 viec dang mo = dung suc chua 4
    expect(stat('nam')).toEqual({ done: 11, onTime: 7, open: 2 }); // hay tre
    expect(stat('oanh')).toEqual({ done: 9, onTime: 9, open: 1 }); // luon dung han
    expect(stat('phuc')).toEqual({ done: 2, onTime: 2, open: 0 }); // nguoi moi, ranh
    expect(TEAM_PEOPLE.find((p) => p.key === 'mai')!.capacity).toBe(4);
    expect(DESIGN.filter((c) => c.reopened).length).toBe(2);
  });
});

describe('nhom demo - ghi vao CSDL dung va an toan', () => {
  it('tai khoan, khong gian, ho so, bang, the: dung so luong, quan he va moc thoi gian (han 23:59 gio VN)', async () => {
    const r = await seedTeam(prisma, { today: TODAY });
    expect(r.removed).toEqual({ users: 0, workspaces: 0 });
    expect(r.counts).toEqual({ users: 5, boards: 4, cards: 64, done: 48, open: 9, unassigned: 7 });

    expect(await teamUsers()).toBe(5);
    const users = await prisma.user.findMany({ where: { email: { endsWith: `@${TEAM_EMAIL_DOMAIN}` } } });
    expect(users.every((u) => u.emailVerifiedAt !== null && u.passwordHash !== null)).toBe(true);
    // Moi nguoi co 1 khong gian ca nhan (giong luc dang ky that) + khong gian nhom do truong nhom so huu
    expect(await prisma.workspace.count({ where: { isPersonal: true, owner: { email: { endsWith: `@${TEAM_EMAIL_DOMAIN}` } } } })).toBe(5);
    const ws = await prisma.workspace.findUniqueOrThrow({ where: { id: r.workspaceId }, include: { owner: true } });
    expect(ws.name).toBe(TEAM_WORKSPACE_NAME);
    expect(ws.owner.email).toBe(`long@${TEAM_EMAIL_DOMAIN}`);

    const members = await prisma.workspaceMember.findMany({ where: { workspaceId: r.workspaceId }, include: { user: true } });
    expect(members.map((m) => `${m.user.email}:${m.role}`).sort()).toEqual(
      TEAM_PEOPLE.map((p) => `${p.email}:${p.key === 'long' ? 'OWNER' : 'MEMBER'}`).sort()
    );
    const profiles = await prisma.memberWorkProfile.findMany({ where: { workspaceId: r.workspaceId }, include: { user: true } });
    expect(Object.fromEntries(profiles.map((p) => [p.user.email, p.maxParallelCards]))).toEqual(
      Object.fromEntries(TEAM_PEOPLE.map((p) => [p.email, p.capacity]))
    );

    expect(await prisma.board.count({ where: { workspaceId: r.workspaceId } })).toBe(4);
    expect(await prisma.list.count({ where: { board: { workspaceId: r.workspaceId } } })).toBe(12);
    // Sprint dang chay co du 5 nguoi (ung vien); nguoi moi (vao 21 ngay truoc) chi co mat o bang dang chay
    const boardMembers = async (i: number) => prisma.boardMember.count({ where: { boardId: r.boardIds[i]!, deletedAt: null } });
    expect(await Promise.all(TEAM_BOARDS.map((_, i) => boardMembers(i)))).toEqual([4, 4, 4, 5]);

    const cards = await prisma.card.findMany({
      where: { list: { board: { workspaceId: r.workspaceId } } },
      include: { members: { include: { user: true } }, list: true },
    });
    expect(cards).toHaveLength(64);
    for (const c of cards.filter((x) => x.isDone)) {
      expect(c.list.name).toBe('Hoàn thành');
      expect(c.members).toHaveLength(1);
      expect(c.completedAt).not.toBeNull();
      expect(c.dueDate!.toISOString().slice(11, 19)).toBe('16:59:00'); // 23:59 gio VN
      expect(c.startDate!.toISOString().slice(11, 19)).toBe('17:00:00'); // 00:00 gio VN
    }
    for (const c of cards.filter((x) => !x.isDone && x.members.length > 0)) expect(c.list.name).toBe('Đang làm');
    const todo = cards.filter((x) => x.members.length === 0);
    expect(todo).toHaveLength(7);
    expect(todo.every((c) => c.list.name === 'Cần làm' && c.list.boardId === r.boardIds[3])).toBe(true);
    expect(todo.map((c) => c.id).sort()).toEqual([...r.todoCardIds].sort());
    expect(r.todoListId).toBe(todo[0]!.listId);

    // Ti le dung han doc TU DB (completedAt <= dueDate) khop thiet ke
    const onTime = (email: string) => {
      const mine = cards.filter((c) => c.isDone && c.members[0]!.user.email === email);
      return `${mine.filter((c) => c.completedAt! <= c.dueDate!).length}/${mine.length}`;
    };
    expect(TEAM_PEOPLE.map((p) => onTime(p.email))).toEqual(['12/14', '10/12', '7/11', '9/9', '2/2']);

    // Nhat ky: the tung bi mo lai co `card.undone` (bo cham doc dau hieu nay)
    expect(await prisma.activity.count({ where: { type: 'card.undone', board: { workspaceId: r.workspaceId } } })).toBe(2);
  });

  it('chay lai khong nhan doi; khong dung toi nguoi khac va du lieu @sim.local; xoa sach roi xoa lan nua thi khong co gi', async () => {
    const stranger = await makeDirectUser('Nguoi la', { email: 'nguoi.la@example.test' });
    const sim = await prisma.user.create({ data: { email: 'sim1@sim.local', name: 'Mo phong', passwordHash: 'x' }, select: { id: true } });

    await seedTeam(prisma, { today: TODAY });
    const second = await seedTeam(prisma, { today: TODAY });
    expect(second.removed).toEqual({ users: 5, workspaces: 6 }); // 5 ca nhan + 1 nhom
    expect(await teamUsers()).toBe(5);
    expect(await prisma.workspace.count({ where: { name: TEAM_WORKSPACE_NAME } })).toBe(1);
    expect(await prisma.card.count()).toBe(64);

    // Ghi 1 dong nhat ky goi y cua nhom, roi xoa: phai bi don theo
    const s = await suggestForCard(second.userIds.long!, second.todoCardIds[0]!, NOW);
    expect(s.runId).not.toBeNull();
    expect(await prisma.assignRun.count()).toBe(1);

    const removed = await removeTeam(prisma);
    expect(removed).toEqual({ users: 5, workspaces: 6 });
    expect(await teamUsers()).toBe(0);
    expect(await prisma.card.count()).toBe(0);
    expect(await prisma.assignRun.count()).toBe(0);
    expect(await removeTeam(prisma)).toEqual({ users: 0, workspaces: 0 });

    // Nguoi la va tai khoan mo phong con nguyen ven suot ca ba lan chay
    expect(await prisma.user.findUnique({ where: { id: stranger.id } })).not.toBeNull();
    expect(await prisma.workspace.count({ where: { ownerId: stranger.id } })).toBe(1);
    expect(await prisma.user.findUnique({ where: { id: sim.id } })).not.toBeNull();
  });

  it('dang nhap that bang mat khau chung; thanh vien moi mo duoc the chua giao cua sprint dang chay', async () => {
    const r = await seedTeam(prisma, { today: TODAY });
    for (const p of TEAM_PEOPLE) {
      const res = await agent().post('/api/auth/login').send({ email: p.email, password: TEAM_PASSWORD });
      expect(res.status, p.email).toBe(200);
      if (p.key === 'phuc') {
        const cookie = res.headers['set-cookie'] as unknown as string[];
        const card = await agent().get(`/api/cards/${r.todoCardIds[0]}`).set('Cookie', cookie);
        expect(card.status).toBe(200);
      }
    }
    const wrong = await agent().post('/api/auth/login').send({ email: `long@${TEAM_EMAIL_DOMAIN}`, password: 'SaiMatKhau1' });
    expect(wrong.status).toBe(401);
  });
});

describe('nhom demo - bo cham THAT cho ra dung cau chuyen cua du lieu', () => {
  const titleOf = (needle: string) => DESIGN.find((c) => c.assigneeKey === null && c.title.includes(needle))!.title;

  async function setup() {
    const r = await seedTeam(prisma, { today: TODAY });
    const keyOf = new Map(TEAM_PEOPLE.map((p) => [r.userIds[p.key]!, p.key]));
    const idByTitle = new Map<string, string>();
    for (const id of r.todoCardIds) {
      const c = await prisma.card.findUniqueOrThrow({ where: { id }, select: { title: true } });
      idByTitle.set(c.title, id);
    }
    const suggest = async (needle: string) => {
      const s = await suggestForCard(r.userIds.long!, idByTitle.get(titleOf(needle))!, NOW);
      const by = (key: string): Suggestion => s.candidates.find((c) => keyOf.get(c.user.id) === key)!;
      // Nguoi co diem kinh nghiem cao nhat (bang chung ve CHU DE, khong phu thuoc trong so)
      const topExperience = s.candidates.reduce((a, b) => ((b.components.experience.value ?? -1) > (a.components.experience.value ?? -1) ? b : a));
      return { s, by, topExperienceKey: keyOf.get(topExperience.user.id)! };
    };
    return { r, keyOf, idByTitle, suggest };
  }

  it('moi viec co du 5 ung vien; moi nguoi la chuyen gia (kinh nghiem cao nhat) cua dung mang viec cua minh', async () => {
    const { suggest } = await setup();
    const cases: Array<[needle: string, expertKey: string]> = [
      ['trang so sánh sản phẩm', 'long'],
      ['thời gian giao hàng', 'mai'],
      ['Google và Facebook', 'nam'],
      ['ngăn kéo cho màn hình', 'oanh'],
      ['kiểm thử giao diện cho trang giỏ hàng', 'mai'],
      ['ở chân trang', 'phuc'],
    ];
    for (const [needle, expert] of cases) {
      const { s, topExperienceKey } = await suggest(needle);
      expect(s.candidateCount, needle).toBe(5);
      expect(topExperienceKey, needle).toBe(expert);
    }
  });

  it('xep hang: chuyen gia dung dau (hoac nhi) khi ranh; Mai gioi gio hang nhung dang qua tai nen bi gan co va tut hang', async () => {
    const { suggest } = await setup();

    expect((await suggest('trang so sánh sản phẩm')).by('long').rank).toBe(1);
    expect((await suggest('ngăn kéo cho màn hình')).by('oanh').rank).toBe(1);
    expect((await suggest('Google và Facebook')).by('nam').rank).toBeLessThanOrEqual(2);

    const cart = await suggest('kiểm thử giao diện cho trang giỏ hàng');
    const mai = cart.by('mai');
    expect(mai.flags).toContain('OVERLOADED'); // 4/4 viec dang mo, chong lan cua so cua the moi
    expect(mai.load).toBe(4);
    expect(mai.capacity).toBe(4);
    expect(mai.components.availability.value).toBe(0);
    // Kinh nghiem gio hang cao nhat nhom nhung khong dung dau vi het cho
    expect(cart.topExperienceKey).toBe('mai');
    expect(mai.rank).toBeGreaterThan(1);
  });

  it('nguoi moi (Phuc): viec ngoai so truong bi gan NO_SIMILAR + du lieu mong; viec chan trang thi dung dau nho ranh va co bang chung', async () => {
    const { suggest } = await setup();

    const other = (await suggest('thời gian giao hàng')).by('phuc');
    expect(other.flags).toContain('NO_SIMILAR');
    expect(other.confidenceLevel).toBe('THIN');
    expect(other.load).toBe(0);
    expect(other.components.availability.value).toBe(1);

    const footer = await suggest('ở chân trang');
    expect(footer.by('phuc').rank).toBe(1);
    expect(footer.by('phuc').evidence.length).toBeGreaterThan(0);
    // Ngay ca viec chan trang, nguoi co it bang chung nhat van khong du "day du"
    expect(footer.by('phuc').confidenceLevel).not.toBe('GOOD');
  });

  it('chia ca cot "Can lam": xep theo han gap nhat truoc; moi the co nguoi nhan; cac chuyen gia nhan dung viec cua ho', async () => {
    const { r, keyOf } = await setup();
    const plan = await planForList(r.userIds.long!, r.todoListId, NOW);
    expect(plan.totalUnassigned).toBe(7);
    expect(plan.truncated).toBe(false);
    expect(plan.rows).toHaveLength(7);
    expect(plan.rows.every((row) => row.assignee !== null)).toBe(true);

    // Han gap truoc (6, 8, 9, 12 ngay nua), roi cac the khong dat han theo thu tu trong cot
    expect(plan.rows.slice(0, 4).map((row) => row.card.title)).toEqual([
      titleOf('thời gian giao hàng'),
      titleOf('Google và Facebook'),
      titleOf('trang so sánh sản phẩm'),
      titleOf('kiểm thử giao diện cho trang giỏ hàng'),
    ]);
    const who = (needle: string) => keyOf.get(plan.rows.find((row) => row.card.title === titleOf(needle))!.assignee!.user.id);
    expect(who('thời gian giao hàng')).toBe('mai');
    expect(who('Google và Facebook')).toBe('nam');
    expect(who('trang so sánh sản phẩm')).toBe('long');
    expect(who('ở chân trang')).toBe('phuc');

    // Xem truoc KHONG ghi gi (khong AssignRun, khong nguoi nhan moi)
    expect(await prisma.assignRun.count()).toBe(0);
    expect(await prisma.cardMember.count({ where: { cardId: { in: r.todoCardIds } } })).toBe(0);
  });
});
