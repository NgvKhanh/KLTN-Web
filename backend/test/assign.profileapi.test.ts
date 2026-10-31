// Buoc 17 - API ho so tu khai + CV (ASSIGN_MODULE.md §17.8-17.9): luu ho so, tai CV len (trich chu, luu tep RIENG), xoa, tai ve co
// quyen (chu CV, hoac chu / quan tri bang / khong gian chung KHI chu CV BAT "chia se CV" - mac dinh tat; con lai 404), gioi han.
// Test tich hop qua HTTP tren DB THAT + tien trinh con THAT.
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CV_DIR, cvDiskPath } from '../src/config/upload';
import { prisma } from '../src/config/prisma';
import { canDownloadCv, cvDownloadableOf, uploadMyCv } from '../src/modules/declaredProfile/declaredProfile.service';
import { buildDocx, buildPdf, para } from './fixtures/ai/documents';
import { agent, makeDirectUser, type TestUser } from './helpers';
import { candOf, giveHistory, newTarget, suggest, world } from './assignFixtures';

const ME = '/api/me/assign-profile';
const get = (u: TestUser | null) => (u ? agent().get(ME).set('Cookie', u.cookie) : agent().get(ME));
const put = (u: TestUser | null, body: unknown) => (u ? agent().put(ME).set('Cookie', u.cookie).send(body as object) : agent().put(ME).send(body as object));
const upload = (u: TestUser | null, file: Buffer | null, name = 'cv.docx') => {
  let r = agent().post(`${ME}/cv`);
  if (u) r = r.set('Cookie', u.cookie);
  return file ? r.attach('file', file, name) : r.field('x', 'y');
};
const delCv = (u: TestUser) => agent().delete(`${ME}/cv`).set('Cookie', u.cookie);
const myCv = (u: TestUser) => agent().get(`${ME}/cv`).set('Cookie', u.cookie).buffer(true).parse((res, cb) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
});
const userCv = (u: TestUser | null, id: string) => {
  const r = agent().get(`/api/users/${id}/assign-profile/cv`);
  return u ? r.set('Cookie', u.cookie) : r;
};
const filesInCv = () => (fs.existsSync(CV_DIR) ? fs.readdirSync(CV_DIR) : []);
// Chu CV chu dong BAT "chia se CV" (mac dinh TAT) qua API that. PUT khong gui cvShared se GIU gia tri, nen goi lai ho so hien co.
const setShare = async (u: TestUser, cvShared: boolean) => {
  const cur = (await get(u)).body.data;
  return put(u, { useForAssign: cur.useForAssign, cvShared, skillsText: cur.skillsText, workItems: cur.workItems, cvText: cur.cvText });
};
const shareCv = (u: TestUser) => setShare(u, true);

// Test tao tep that trong CV_DIR (thu muc TAM cua test - test/uploadsIsolation.ts, khong phai backend/uploads): don cac tep MOI
// sinh ra sau moi test (TRUNCATE chi xoa dong CSDL). Danh sach "tep co san" chup NGAY khi nap tep va sau moi lan don: ban dau de
// rong thi lan don dau tien xoa sach ca tep khong phai cua test (04/10 da mat mot CV that vi loi nay, khi CV_DIR con la thu muc that).
// Tep "cua nguoi khac" dat san TRUOC khi chup: ca cuoi tep kiem no con nguyen (bat dung loi 04/10)
const FOREIGN = 'khong-phai-cua-test.pdf';
fs.mkdirSync(CV_DIR, { recursive: true });
fs.writeFileSync(path.join(CV_DIR, FOREIGN), 'tep co san, test khong duoc xoa');
let before = new Set<string>(filesInCv());
afterEach(() => {
  for (const f of filesInCv()) if (!before.has(f)) fs.rmSync(path.join(CV_DIR, f), { force: true });
  before = new Set(filesInCv());
});
const startTracking = () => {
  before = new Set(filesInCv());
};

const CV_TEXT = 'Kinh nghiem thiet ke giao dien quen mat khau cho ung dung ngan hang ABC';
const cvDocx = () => buildDocx({ body: para(CV_TEXT) });

const VALID = {
  useForAssign: true,
  skillsText: 'React, SQL',
  workItems: [{ title: 'Trang quan tri', description: 'Dashboard' }],
  cvText: null,
};

describe('GET / PUT /api/me/assign-profile', () => {
  it('chua khai -> ho so rong mac dinh (bat "dung cho goi y"); chua dang nhap 401; PUT luu du, cap ma cong viec; lan sau giu ma', async () => {
    const u = await makeDirectUser('A');
    expect((await get(null)).status).toBe(401);
    expect((await get(u)).body.data).toEqual({ useForAssign: true, cvShared: false, skillsText: '', workItems: [], cv: null, cvText: null });
    const r = await put(u, VALID);
    expect(r.status).toBe(200);
    const items = r.body.data.workItems as { id: string; title: string; description: string | null }[];
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ title: 'Trang quan tri', description: 'Dashboard' });
    expect(items[0]!.id.length).toBeGreaterThan(8);
    // Gui lai kem ma -> giu nguyen ma; mo ta vang -> null
    const again = await put(u, { ...VALID, workItems: [{ id: items[0]!.id, title: 'Trang quan tri 2' }] });
    expect(again.body.data.workItems).toEqual([{ id: items[0]!.id, title: 'Trang quan tri 2', description: null }]);
    const row = await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(row.skillsText).toBe('React, SQL');
    expect((await get(u)).body.data.skillsText).toBe('React, SQL');
  });

  it('gioi han (§17.2) -> 400, khong ghi: ky nang > 2000, > 30 cong viec, ten rong / > 200, mo ta > 1000, CV > 20 000, thieu truong, sai kieu', async () => {
    const u = await makeDirectUser('B');
    const work = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Viec ${i}` }));
    const bad: [string, unknown][] = [
      ['ky nang dai', { ...VALID, skillsText: 'x'.repeat(2001) }],
      ['31 cong viec', { ...VALID, workItems: work(31) }],
      ['ten rong', { ...VALID, workItems: [{ title: '   ' }] }],
      ['ten dai', { ...VALID, workItems: [{ title: 'x'.repeat(201) }] }],
      ['mo ta dai', { ...VALID, workItems: [{ title: 'a', description: 'x'.repeat(1001) }] }],
      ['CV dai', { ...VALID, cvText: 'x'.repeat(20001) }],
      ['thieu cong tac', { skillsText: '', workItems: [], cvText: null }],
      ['thieu ky nang', { useForAssign: true, workItems: [], cvText: null }],
      ['thieu cong viec', { useForAssign: true, skillsText: '', cvText: null }],
      ['thieu chu CV', { useForAssign: true, skillsText: '', workItems: [] }],
      ['cong tac khong phai boolean', { ...VALID, useForAssign: 'yes' }],
      ['cvShared khong phai boolean', { ...VALID, cvShared: 'yes' }],
    ];
    for (const [label, body] of bad) expect((await put(u, body)).status, label).toBe(400);
    expect(await prisma.userAssignProfile.count()).toBe(0);
    // Bien van hop le
    expect((await put(u, { ...VALID, skillsText: 'x'.repeat(2000), workItems: work(30), cvText: 'y'.repeat(20000) })).status).toBe(200);
  });

  it('ho so vua luu duoc DUNG trong goi y ngay (khong can tai lai); tat cong tac -> khong dung', async () => {
    const w = await world();
    const target = await newTarget(w.listId);
    await giveHistory(w.listId, w.alice.id);
    await put(w.bob, { ...VALID, skillsText: 'giao dien quen mat khau' });
    const on = await suggest(w.owner, target.id);
    expect(candOf(on.body, w.bob).components.declared.value).toBeGreaterThan(0.5);
    await put(w.bob, { ...VALID, useForAssign: false, skillsText: 'giao dien quen mat khau' });
    const off = await suggest(w.owner, target.id);
    expect(candOf(off.body, w.bob).components.declared.value).toBeNull();
  });
});

describe('POST / DELETE / GET /api/me/assign-profile/cv', () => {
  it('tai .docx: trich chu (tra ve de sua), luu tep RIENG ten ngau nhien, cvText = chu trich; tai lai tep cua minh dung byte', async () => {
    startTracking();
    const u = await makeDirectUser('C');
    const file = await cvDocx();
    const r = await upload(u, file, 'CV Nguyen Van A.docx');
    expect(r.status).toBe(200);
    expect(r.body.data.text).toContain('thiet ke giao dien quen mat khau');
    expect(r.body.data.truncated).toBe(false);
    expect(r.body.data.cv).toMatchObject({ fileName: 'CV Nguyen Van A.docx', size: file.length });
    const row = await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(row.cvStoredName).toMatch(/^[0-9a-f-]{36}\.docx$/);
    expect(row.cvText).toContain('ngan hang ABC');
    // Chu CV tra ve cho CHINH chu (de sua): trong ket qua tai len va o GET
    expect(r.body.data.profile.cvText).toBe(row.cvText);
    expect((await get(u)).body.data.cvText).toBe(row.cvText);
    expect(fs.readFileSync(path.join(CV_DIR, row.cvStoredName!)).equals(file)).toBe(true);
    const got = await myCv(u);
    expect(got.status).toBe(200);
    expect(Buffer.compare(got.body as Buffer, file)).toBe(0);
    expect(got.headers['content-disposition']).toMatch(/^attachment; filename\*=UTF-8''CV%20Nguyen%20Van%20A\.docx$/);
    expect(got.headers['content-type']).toContain('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(got.headers['x-content-type-options']).toBe('nosniff');
    expect(got.headers['cache-control']).toBe('no-store');
    // Tep KHONG duoc phuc vu tinh o bat ky duong dan /uploads nao (ke ca dang ma hoa)
    for (const url of [`/uploads/cv/${row.cvStoredName}`, `/uploads/%63v/${row.cvStoredName}`, `/uploads/avatars/../cv/${row.cvStoredName}`]) {
      const r2 = await agent().get(url).set('Cookie', u.cookie);
      expect(r2.status, url).toBe(404);
    }
  });

  it('tai .pdf; thay CV -> tep cu bi XOA khoi dia; duoi tep tren dia theo loai DA KIEM (khong lay tu ten nguoi dung)', async () => {
    startTracking();
    const u = await makeDirectUser('D');
    await upload(u, await cvDocx());
    const first = (await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } })).cvStoredName!;
    const pdf = buildPdf([[CV_TEXT]]);
    const r = await upload(u, pdf, 'cv.pdf');
    expect(r.status).toBe(200);
    const second = (await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } })).cvStoredName!;
    expect(second).toMatch(/\.pdf$/);
    expect(fs.existsSync(path.join(CV_DIR, first))).toBe(false);
    expect(fs.existsSync(path.join(CV_DIR, second))).toBe(true);
    expect((await myCv(u)).headers['content-type']).toContain('application/pdf');
  });

  it('tep hong / gia duoi / sai loai / thieu tep -> 400 va KHONG ghi tep nao, KHONG doi ho so', async () => {
    startTracking();
    const u = await makeDirectUser('E');
    for (const [label, buf, name] of [
      ['chu thuong dat ten .pdf', Buffer.from('xin chao, day khong phai pdf'), 'cv.pdf'],
      ['chu thuong dat ten .docx', Buffer.from('xin chao'), 'cv.docx'],
      ['anh', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]), 'cv.png'],
      ['exe doi ten', Buffer.from('MZ\x90\x00'), 'cv.docx'],
      ['pdf that dat ten .docx', buildPdf([[CV_TEXT]]), 'cv.docx'],
      ['ten goc .pdf.exe', buildPdf([[CV_TEXT]]), 'cv.pdf.exe'],
    ] as [string, Buffer, string][]) {
      expect((await upload(u, buf, name)).status, label).toBe(400);
    }
    expect((await upload(u, null)).status).toBe(400);
    expect((await upload(null, await cvDocx())).status).toBe(401);
    expect(filesInCv().filter((f) => !before.has(f))).toEqual([]);
    expect(await prisma.userAssignProfile.count()).toBe(0);
  });

  it('DELETE: xoa tep tren dia + chu + moi cot cv*; ky nang giu nguyen; chua co CV thi khong loi; GET tep cua minh -> 404', async () => {
    startTracking();
    const u = await makeDirectUser('F');
    await put(u, VALID);
    await upload(u, await cvDocx());
    const stored = (await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } })).cvStoredName!;
    const r = await delCv(u);
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ cv: null, cvText: null, skillsText: 'React, SQL' });
    expect(fs.existsSync(path.join(CV_DIR, stored))).toBe(false);
    const row = await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect([row.cvText, row.cvFileName, row.cvStoredName, row.cvSize, row.cvUploadedAt]).toEqual([null, null, null, null, null]);
    expect((await delCv(u)).status).toBe(200);
    expect((await myCv(u)).status).toBe(404);
    const nobody = await makeDirectUser('G');
    expect((await delCv(nobody)).status).toBe(200);
    // Chu CV go tay (khong co tep) cung bi xoa; tep da mat tren dia van xoa duoc (200, khong 500)
    await put(u, { ...VALID, cvText: 'Chu CV go tay' });
    expect((await delCv(u)).body.data.cvText).toBeNull();
    await upload(u, await cvDocx());
    const gone = (await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } })).cvStoredName!;
    fs.rmSync(path.join(CV_DIR, gone));
    expect((await delCv(u)).status).toBe(200);
    expect((await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } })).cvStoredName).toBeNull();
  });

  it('uploadMyCv (goi thang): ten hien thi chi lay PHAN TEN (bo duong dan), toi da 200 ky tu; ten luu tren dia khong phu thuoc ten goc', async () => {
    startTracking();
    const u = await makeDirectUser('H');
    const file = await cvDocx();
    const r = await uploadMyCv(u.id, { buffer: file, originalname: '..\\..\\thu muc\\cv cua toi.docx' });
    expect(r.cv.fileName).toBe('cv cua toi.docx');
    const long = `${'a'.repeat(300)}.docx`;
    const r2 = await uploadMyCv(u.id, { buffer: file, originalname: long });
    expect(r2.cv.fileName).toBe('a'.repeat(200));
    const row = await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: u.id } });
    expect(row.cvStoredName).toMatch(/^[0-9a-f-]{36}\.docx$/);
    expect(filesInCv().filter((f) => !before.has(f))).toEqual([row.cvStoredName]);
    // Duong dan tren dia luon nam trong CV_DIR (basename chan ../)
    expect(cvDiskPath('../../etc/passwd')).toBe(path.join(CV_DIR, 'passwd'));
  });

  it('ghi CSDL LOI sau khi da ghi tep -> tep moi bi DON (khong de rac)', async () => {
    startTracking();
    // Loi CSDL THAT (khong mock - spyOn tren delegate cua Prisma 7 lam hong cac lan goi sau): nguoi dung khong ton tai -> vi pham
    // khoa ngoai khi tao dong, SAU khi tep da duoc ghi
    await expect(uploadMyCv('khong-ton-tai', { buffer: buildPdf([[CV_TEXT]]), originalname: 'moi.pdf' })).rejects.toThrow();
    expect(filesInCv().filter((f) => !before.has(f))).toEqual([]);
    expect(await prisma.userAssignProfile.count()).toBe(0);
  });

  it('gioi han toc do tai CV: 10 lan / nguoi / 10 phut (ke ca lan loi), lan 11 -> 429; nguoi khac khong bi anh huong', async () => {
    const u = await makeDirectUser('J');
    for (let i = 0; i < 10; i += 1) expect((await upload(u, null)).status, `lan ${i + 1}`).toBe(400);
    expect((await upload(u, null)).status).toBe(429);
    expect((await upload(await makeDirectUser('K'), null)).status).toBe(400);
  });
});

/** Bang trong khong gian `workspaceId`, chu bang `ownerId` (co dong OWNER), cac thanh vien con lai theo vai tro. */
async function mkBoard(workspaceId: string, ownerId: string, members: [string, 'ADMIN' | 'MEMBER' | 'VIEWER'][] = [], name = 'Bang') {
  return prisma.board.create({
    data: {
      workspaceId,
      ownerId,
      name,
      members: { create: [{ userId: ownerId, role: 'OWNER' }, ...members.map(([userId, role]) => ({ userId, role }))] },
    },
    select: { id: true },
  });
}

describe('GET /api/users/:userId/assign-profile/cv - quyen tai CV (luat 04/10: quan ly BANG chung)', () => {
  it('chu CV, chu / quan tri BANG co nguoi do, chu / quan tri KHONG GIAN chua bang: duoc; thanh vien / nguoi xem bang, thanh vien khong gian, quan tri bang KHAC, nguoi ngoai: 404; chua dang nhap 401', async () => {
    startTracking();
    const [wsOwner, wsAdmin, wsMember, boardOwner, boardAdmin, boardMember, boardViewer, otherBoardAdmin, target, outsider, otherOwner] =
      await Promise.all(
        ['WsOwner', 'WsAdmin', 'WsMember', 'BoardOwner', 'BoardAdmin', 'BoardMember', 'BoardViewer', 'OtherBoardAdmin', 'Target', 'Outsider', 'OtherOwner'].map(
          (n) => makeDirectUser(n)
        )
      );
    const ws = await prisma.workspace.create({
      data: {
        ownerId: wsOwner.id,
        name: 'Nhom',
        members: {
          create: [
            { userId: wsOwner.id, role: 'OWNER' },
            { userId: wsAdmin.id, role: 'ADMIN' },
            { userId: wsMember.id, role: 'MEMBER' },
          ],
        },
      },
      select: { id: true },
    });
    // target CHI la thanh vien BANG, khong phai thanh vien khong gian (truong hop pho bien: moi vao bang)
    await mkBoard(ws.id, boardOwner.id, [
      [boardAdmin.id, 'ADMIN'],
      [boardMember.id, 'MEMBER'],
      [boardViewer.id, 'VIEWER'],
      [target.id, 'MEMBER'],
    ]);
    await mkBoard(ws.id, otherBoardAdmin.id, [], 'Bang khac khong co target');
    const ws2 = await prisma.workspace.create({ data: { ownerId: otherOwner.id, name: 'Khac', members: { create: [{ userId: otherOwner.id, role: 'OWNER' }] } }, select: { id: true } });
    await mkBoard(ws2.id, otherOwner.id);
    await upload(target, await cvDocx());

    // Mac dinh chia se TAT: ke ca chu / quan tri bang va khong gian chua target cung KHONG tai duoc; chinh chu thi duoc
    for (const u of [boardOwner, boardAdmin, wsOwner, wsAdmin]) expect((await userCv(u, target.id)).status, u.name).toBe(404);
    expect((await userCv(target, target.id).buffer(true)).status).toBe(200);
    expect((await shareCv(target)).status).toBe(200);

    for (const u of [target, boardOwner, boardAdmin, wsOwner, wsAdmin]) {
      const r = await userCv(u, target.id).buffer(true);
      expect(r.status, u.name).toBe(200);
      expect(r.headers['content-disposition'], u.name).toMatch(/^attachment;/);
    }
    for (const u of [boardMember, boardViewer, wsMember, otherBoardAdmin, outsider, otherOwner]) {
      const r = await userCv(u, target.id);
      expect(r.status, u.name).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain('ngan hang');
    }
    expect((await userCv(null, target.id)).status).toBe(401);
    // Nguoi KHONG co CV: ca chu bang cung 404 (giong het "khong co quyen")
    expect((await userCv(boardOwner, boardMember.id)).status).toBe(404);
    expect((await userCv(boardOwner, 'khong-ton-tai')).status).toBe(404);

    // Chu CV TAT "dung cho goi y" -> nguoi khac 404, chinh chu van tai duoc; bat lai -> duoc
    await put(target, { ...VALID, useForAssign: false });
    expect((await userCv(boardOwner, target.id)).status).toBe(404);
    expect((await userCv(wsAdmin, target.id)).status).toBe(404);
    expect((await userCv(target, target.id).buffer(true)).status).toBe(200);
    expect((await myCv(target)).status).toBe(200);
    await put(target, VALID);
    expect((await userCv(boardOwner, target.id).buffer(true)).status).toBe(200);

    // Tep mat tren dia -> 404 (khong 500)
    const stored = (await prisma.userAssignProfile.findUniqueOrThrow({ where: { userId: target.id } })).cvStoredName!;
    fs.rmSync(path.join(CV_DIR, stored));
    expect((await userCv(boardOwner, target.id)).status).toBe(404);
    expect((await myCv(target)).status).toBe(404);
  });

  it('canDownloadCv: tung dieu kien cua luat bang (roi bang, bang / khong gian da xoa, luu tru, chu bang / chu khong gian khong co dong thanh vien)', async () => {
    const boss = await makeDirectUser('Boss');
    const t = await makeDirectUser('T');
    const host = await makeDirectUser('Host');
    const ws = await prisma.workspace.create({ data: { ownerId: host.id, name: 'Nhom', members: { create: [{ userId: host.id, role: 'OWNER' }] } }, select: { id: true } });
    const b = await mkBoard(ws.id, host.id, [
      [boss.id, 'ADMIN'],
      [t.id, 'MEMBER'],
    ]);
    const leave = (userId: string, at: Date | null) => prisma.boardMember.updateMany({ where: { boardId: b.id, userId }, data: { deletedAt: at } });
    expect(await canDownloadCv(boss.id, t.id)).toBe(true); // quan tri bang
    expect(await canDownloadCv(host.id, t.id)).toBe(true); // chu khong gian + chu bang
    expect(await canDownloadCv(t.id, boss.id)).toBe(false); // thanh vien thuong khong xem duoc nguoi khac

    await leave(boss.id, new Date()); // nguoi hoi roi bang
    expect(await canDownloadCv(boss.id, t.id)).toBe(false);
    await leave(boss.id, null);
    await leave(t.id, new Date()); // chu CV roi bang
    expect(await canDownloadCv(boss.id, t.id)).toBe(false);
    await leave(t.id, null);
    expect(await canDownloadCv(boss.id, t.id)).toBe(true);

    await prisma.board.update({ where: { id: b.id }, data: { archivedAt: new Date() } }); // luu tru van tinh
    expect(await canDownloadCv(boss.id, t.id)).toBe(true);
    await prisma.board.update({ where: { id: b.id }, data: { archivedAt: null, deletedAt: new Date() } }); // bang da xoa
    expect(await canDownloadCv(boss.id, t.id)).toBe(false);
    await prisma.board.update({ where: { id: b.id }, data: { deletedAt: null } });
    await prisma.workspace.update({ where: { id: ws.id }, data: { deletedAt: new Date() } }); // khong gian da xoa
    expect(await canDownloadCv(boss.id, t.id)).toBe(false);
    expect(await canDownloadCv(host.id, t.id)).toBe(false);
    await prisma.workspace.update({ where: { id: ws.id }, data: { deletedAt: null } });

    // Quan tri KHONG GIAN (khong o bang nao): duoc; roi khong gian -> het quyen
    const wsAdmin = await makeDirectUser('WsAdmin');
    await prisma.workspaceMember.create({ data: { workspaceId: ws.id, userId: wsAdmin.id, role: 'ADMIN' } });
    expect(await canDownloadCv(wsAdmin.id, t.id)).toBe(true);
    await prisma.workspaceMember.updateMany({ where: { workspaceId: ws.id, userId: wsAdmin.id }, data: { deletedAt: new Date() } });
    expect(await canDownloadCv(wsAdmin.id, t.id)).toBe(false);

    // Chu bang / chu khong gian theo cot ownerId, KHONG co dong thanh vien tuong ung
    const owner2 = await makeDirectUser('Owner2');
    const m2 = await makeDirectUser('M2');
    const admin2 = await makeDirectUser('Admin2');
    const ws2 = await prisma.workspace.create({ data: { ownerId: owner2.id, name: 'Nhom 2', members: { create: [{ userId: admin2.id, role: 'ADMIN' }] } }, select: { id: true } });
    const b2 = await prisma.board.create({ data: { workspaceId: ws2.id, ownerId: m2.id, name: 'Cua M2' }, select: { id: true } });
    expect(await canDownloadCv(owner2.id, m2.id)).toBe(true); // chu khong gian (ownerId), m2 la chu bang (ownerId)
    expect(await canDownloadCv(admin2.id, m2.id)).toBe(true); // quan tri khong gian chua bang
    await prisma.boardMember.create({ data: { boardId: b2.id, userId: owner2.id, role: 'MEMBER' } });
    expect(await canDownloadCv(m2.id, owner2.id)).toBe(true); // m2 la chu bang (ownerId), owner2 la thanh vien bang

    // LUAT CU (thanh vien khong gian, khong chung bang nao) KHONG con du
    const lead = await makeDirectUser('Lead');
    const wm = await makeDirectUser('WsMemberOnly');
    await prisma.workspace.create({ data: { ownerId: lead.id, name: 'Nhom 3', members: { create: [{ userId: lead.id, role: 'OWNER' }, { userId: wm.id, role: 'MEMBER' }] } } });
    expect(await canDownloadCv(lead.id, wm.id)).toBe(false);

    expect(await canDownloadCv(t.id, t.id)).toBe(true);
    // Nguoi KHONG co khong gian / bang nao van tai duoc CV cua chinh minh
    const bare = await prisma.user.create({ data: { email: `bare_${Date.now()}@test.local`, name: 'Bare' }, select: { id: true } });
    expect(await canDownloadCv(bare.id, bare.id)).toBe(true);
  });
});

describe('cvDownloadableOf - hoi theo lo (duong cua cvAvailable)', () => {
  it('cung mot bang: nguoi da roi bang bi loai, nguoi con o lai van duoc; chi nguoi CO tep CV (dong + tep tren dia); chinh minh luon duoc', async () => {
    startTracking();
    const boss = await makeDirectUser('Boss');
    const stay = await makeDirectUser('Stay');
    const left = await makeDirectUser('Left');
    const noCv = await makeDirectUser('NoCv');
    const ws = await prisma.workspace.create({ data: { ownerId: boss.id, name: 'Nhom', members: { create: [{ userId: boss.id, role: 'OWNER' }] } }, select: { id: true } });
    const b = await mkBoard(ws.id, boss.id, [
      [stay.id, 'MEMBER'],
      [left.id, 'MEMBER'],
      [noCv.id, 'MEMBER'],
    ]);
    // Dong ho so + tep that trong CV_DIR (thu muc TAM cua test)
    for (const u of [stay, left, boss]) {
      await prisma.userAssignProfile.create({ data: { userId: u.id, cvShared: true, cvStoredName: `${u.id}.pdf`, cvFileName: 'cv.pdf', cvSize: 1, cvUploadedAt: new Date() } });
      fs.writeFileSync(path.join(CV_DIR, `${u.id}.pdf`), 'pdf');
    }
    await prisma.userAssignProfile.create({ data: { userId: noCv.id, skillsText: 'React' } });
    await prisma.boardMember.updateMany({ where: { boardId: b.id, userId: left.id }, data: { deletedAt: new Date() } });
    expect([...(await cvDownloadableOf(boss.id, [stay.id, left.id, noCv.id, boss.id]))].sort()).toEqual([boss.id, stay.id].sort());
    expect([...(await cvDownloadableOf(stay.id, [stay.id, boss.id]))]).toEqual([stay.id]); // thanh vien thuong: chi chinh minh
    expect([...(await cvDownloadableOf(boss.id, []))]).toEqual([]);
    // Chu CV TAT chia se -> khong con trong danh sach cua nguoi quan ly (chinh chu van tai duoc); bat lai thi tro lai
    await prisma.userAssignProfile.update({ where: { userId: stay.id }, data: { cvShared: false } });
    expect([...(await cvDownloadableOf(boss.id, [stay.id, boss.id]))]).toEqual([boss.id]);
    expect([...(await cvDownloadableOf(stay.id, [stay.id]))]).toEqual([stay.id]);
    await prisma.userAssignProfile.update({ where: { userId: stay.id }, data: { cvShared: true } });
    // Dong con nhung TEP MAT tren dia -> khong co nut (ke ca chinh chu): nut nao hien ra cung bam duoc
    fs.rmSync(path.join(CV_DIR, `${stay.id}.pdf`));
    fs.rmSync(path.join(CV_DIR, `${boss.id}.pdf`));
    expect([...(await cvDownloadableOf(boss.id, [stay.id, boss.id]))]).toEqual([]);
  });
});

describe('GET /api/me/assign-profile/cv-access - ai trong danh sach minh tai duoc CV', () => {
  const access = (u: TestUser | null, query: string) => {
    const r = agent().get(`${ME}/cv-access${query}`);
    return u ? r.set('Cookie', u.cookie) : r;
  };

  it('tra dung tap con theo thu tu da gui (bo trung, bo khoang trang); khong quyen / khong CV / id la -> khong co; chua dang nhap 401', async () => {
    startTracking();
    const w = await world();
    await upload(w.bob, await cvDocx());
    await upload(w.alice, await cvDocx());
    await shareCv(w.bob);
    await shareCv(w.alice);
    const q = `?userIds=${w.alice.id},%20${w.bob.id},${w.bob.id},${w.viewer.id},khong-ton-tai,${w.owner.id}`;
    const r = await access(w.owner, q);
    expect(r.status).toBe(200);
    expect(r.body.data).toEqual({ userIds: [w.alice.id, w.bob.id] }); // owner la chu bang; viewer / chinh owner khong co CV
    // Giu DUNG thu tu da gui (gui nguoc lai -> ket qua nguoc lai)
    expect((await access(w.owner, `?userIds=${w.bob.id},${w.alice.id}`)).body.data).toEqual({ userIds: [w.bob.id, w.alice.id] });
    // Thanh vien thuong cua bang: chi chinh minh
    expect((await access(w.alice, q)).body.data).toEqual({ userIds: [w.alice.id] });
    // Nguoi ngoai: khong ai
    expect((await access(w.outsider, q)).body.data).toEqual({ userIds: [] });
    expect((await access(null, q)).status).toBe(401);
  });

  it('tham so sai -> 400: thieu, rong, chi dau phay, > 200 nguoi, ma qua dai; dung 200 nguoi van duoc', async () => {
    const u = await makeDirectUser('Q');
    for (const q of ['', '?userIds=', '?userIds=,,%20,', `?userIds=${Array.from({ length: 201 }, (_, i) => `u${i}`).join(',')}`, `?userIds=${'x'.repeat(65)}`]) {
      expect((await access(u, q)).status, q.slice(0, 40)).toBe(400);
    }
    const ok = await access(u, `?userIds=${Array.from({ length: 199 }, (_, i) => `u${i}`).join(',')},${u.id}`); // dung 200
    expect(ok.status).toBe(200);
    expect(ok.body.data).toEqual({ userIds: [] });
  });
});

describe('CV di vao bo cham, chu CV khong ra ngoai', () => {
  it('chu trich tu CV (sau khi nguoi dung sua) la mot nguon khop; bang chung muc CV khong co chu', async () => {
    startTracking();
    const w = await world();
    const target = await newTarget(w.listId);
    await giveHistory(w.listId, w.alice.id);
    await upload(w.bob, await cvDocx());
    const res = await suggest(w.owner, target.id);
    const bob = candOf(res.body, w.bob);
    expect(bob.components.declared.value).toBeGreaterThan(0.3);
    expect(bob.declaredEvidence.every((e) => e.kind === 'CV' && e.title === null)).toBe(true);
    expect(JSON.stringify(res.body)).not.toContain('ngan hang');
    // Nguoi dung sua chu CV (bo phan lien quan) -> khong con khop
    const cur = (await get(w.bob)).body.data;
    await put(w.bob, { useForAssign: true, skillsText: cur.skillsText, workItems: cur.workItems, cvText: 'So thich: bong da' });
    expect(candOf((await suggest(w.owner, target.id)).body, w.bob).components.declared.value).toBe(0);
  });

  it('cvAvailable trong goi y: chi true khi nguoi HOI tai duoc (chinh minh / quan ly bang hoac khong gian chua bang)', async () => {
    startTracking();
    const w = await world();
    const target = await newTarget(w.listId);
    await upload(w.bob, await cvDocx());
    // Chua bat chia se -> khong ai ngoai bob co nut tai CV
    expect(candOf((await suggest(w.owner, target.id)).body, w.bob).cvAvailable).toBe(false);
    expect(candOf((await suggest(w.bob, target.id)).body, w.bob).cvAvailable).toBe(true);
    await shareCv(w.bob);
    // bob CHI la thanh vien BANG (khong phai thanh vien khong gian) - chu bang van thay (luat 04/10)
    let res = await suggest(w.owner, target.id);
    expect(candOf(res.body, w.bob).cvAvailable).toBe(true);
    expect(candOf(res.body, w.alice).cvAvailable).toBe(false); // khong co CV
    // alice co ho so (khong CV) -> van false
    await put(w.alice, VALID);
    res = await suggest(w.owner, target.id);
    expect(candOf(res.body, w.alice).cvAvailable).toBe(false);
    expect(candOf(res.body, w.bob).cvAvailable).toBe(true);
    // Chinh bob hoi: thay CV cua minh; alice (thanh vien thuong cua bang) khong thay CV cua bob
    expect(candOf((await suggest(w.bob, target.id)).body, w.bob).cvAvailable).toBe(true);
    expect(candOf((await suggest(w.alice, target.id)).body, w.bob).cvAvailable).toBe(false);
    // alice duoc nang len quan tri bang -> thay
    await prisma.boardMember.updateMany({ where: { boardId: w.boardId, userId: w.alice.id }, data: { role: 'ADMIN' } });
    const asAdmin = (await suggest(w.alice, target.id)).body;
    expect(candOf(asAdmin, w.bob).cvAvailable).toBe(true);
    expect(candOf(asAdmin, w.owner).cvAvailable).toBe(false); // chu bang KHONG co CV -> khong bao gio co nut tai
    // bob tat cong tac -> khong ai khac thay
    await put(w.bob, { ...VALID, useForAssign: false });
    expect(candOf((await suggest(w.owner, target.id)).body, w.bob).cvAvailable).toBe(false);
  });
});

describe('cvShared - cong tac chia se CV (14/10/2026: truoc do bat ky ai them nguoi vao bang cua minh deu tai duoc CV)', () => {
  it('mac dinh TAT; PUT luu / giu / tat; gia tri khong phai boolean -> 400', async () => {
    const u = await makeDirectUser('Chu CV');
    expect((await get(u)).body.data.cvShared).toBe(false);
    expect((await put(u, VALID)).body.data.cvShared).toBe(false); // khong gui cvShared -> mac dinh tat
    expect((await put(u, { ...VALID, cvShared: true })).body.data.cvShared).toBe(true);
    // Ban cu cua client khong gui cvShared -> GIU gia tri hien tai (khong tat ngam)
    expect((await put(u, { ...VALID, skillsText: 'Docker' })).body.data.cvShared).toBe(true);
    expect((await get(u)).body.data.cvShared).toBe(true);
    expect((await put(u, { ...VALID, cvShared: false })).body.data.cvShared).toBe(false);
    expect((await put(u, { ...VALID, cvShared: 1 })).status).toBe(400);
    expect((await get(u)).body.data.cvShared).toBe(false);
  });

  it('nguoi la tao bang rieng roi them nan nhan vao DO KHONG tai duoc CV khi chua bat chia se; bat roi moi tai duoc; tat lai thi het', async () => {
    startTracking();
    const victim = await makeDirectUser('Nan nhan');
    const stranger = await makeDirectUser('Nguoi la');
    await upload(victim, await cvDocx());
    const board = await agent().post('/api/boards').set('Cookie', stranger.cookie).send({ name: 'Bang cua nguoi la', workspaceId: stranger.personalWorkspaceId });
    expect(board.status).toBe(201);
    const add = await agent()
      .post(`/api/boards/${board.body.data.board.id}/members`)
      .set('Cookie', stranger.cookie)
      .send({ email: victim.email, role: 'MEMBER' });
    expect(add.status).toBe(201); // them thang, khong can dong y (hanh vi sao chep Trello cua he thong)

    expect((await userCv(stranger, victim.id)).status).toBe(404); // truoc day: 200
    expect((await shareCv(victim)).status).toBe(200);
    expect((await userCv(stranger, victim.id).buffer(true)).status).toBe(200);
    // Tat "dung cho goi y" ghi de chia se: rut CV khoi moi nguoi
    await put(victim, { ...VALID, useForAssign: false });
    expect((await userCv(stranger, victim.id)).status).toBe(404);
    await put(victim, { ...VALID, useForAssign: true });
    expect((await userCv(stranger, victim.id).buffer(true)).status).toBe(200);
    await setShare(victim, false);
    expect((await userCv(stranger, victim.id)).status).toBe(404);
    expect((await myCv(victim)).status).toBe(200); // chinh chu luon tai duoc
  });
});

describe('don tep cua test khong dung vao tep co san', () => {
  it('tep dat san truoc khi chay (khong do test tao) van con nguyen sau moi ca o tren', () => {
    expect(filesInCv()).toContain(FOREIGN);
    fs.rmSync(path.join(CV_DIR, FOREIGN), { force: true });
  });
});
