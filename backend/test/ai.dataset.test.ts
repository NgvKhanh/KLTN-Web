import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isValidIso } from '../src/modules/ai/ai.dates';
import { detectMode, normalizeText, splitLines } from '../src/modules/ai/ai.rules';
import { DATASET, DATASET_TODAY, sampleText, type DatasetSample } from '../src/scripts/evalDataset';

// Buoc 10: bo du lieu danh gia. Test nay KHONG do chat luong AI - no bao dam bo du lieu nhat quan
// voi bo tach dong that (nhan vang la SO DONG) va bi DONG BANG (moi chinh sua vo y deu rot).

const byId = (id: string): DatasetSample => DATASET.find((s) => s.id === id)!;

describe('bo du lieu danh gia: cau truc', () => {
  it('25 mau: 10 STRUCTURED / 10 FREEFORM / 5 NOISY, id duy nhat dung tien to nhom', () => {
    expect(DATASET).toHaveLength(25);
    const count = (g: string) => DATASET.filter((s) => s.group === g).length;
    expect([count('STRUCTURED'), count('FREEFORM'), count('NOISY')]).toEqual([10, 10, 5]);
    expect(new Set(DATASET.map((s) => s.id)).size).toBe(25);
    const prefix = { STRUCTURED: 'S', FREEFORM: 'F', NOISY: 'N' } as const;
    for (const s of DATASET) expect(s.id).toMatch(new RegExp(`^${prefix[s.group]}\\d{2}$`));
  });

  it('DONG BANG: tong so dong / viec / dong co ngay / khoang ngay khong doi', () => {
    const sum = (f: (s: DatasetSample) => number) => DATASET.reduce((a, s) => a + f(s), 0);
    expect(sum((s) => s.lines.length)).toBe(228);
    expect(sum((s) => s.lines.filter((l) => l.task).length)).toBe(169);
    expect(sum((s) => s.lines.filter((l) => l.due !== undefined || l.start !== undefined).length)).toBe(70);
    expect(sum((s) => s.lines.filter((l) => l.start !== undefined).length)).toBe(7);
    expect(DATASET_TODAY).toBe('2026-09-19');
  });

  it('DONG BANG: dau van tay sha256 cua TOAN BO noi dung (chu, nhan viec, ngay, khoang du an) khong doi', () => {
    // Khi CO CHU Y sua bo du lieu (vd sau khi duyet nhan): chay `npx vitest run test/ai.dataset.test.ts`,
    // xac nhan sua dung y, roi chep gia tri moi vao day. Nho ghi trong luan van neu sua SAU KHI da xem ket qua.
    const hash = createHash('sha256').update(JSON.stringify(DATASET)).digest('hex');
    expect(hash).toBe('5613dbace59916649da8420f100ce90ff26f82930261cfbbf834e077b04269e6');
  });

  it('DONG BANG: moi mau co so dong va so viec nhu da chot (chinh mot dong la bi bat)', () => {
    expect(DATASET.map((s) => `${s.id}:${s.lines.length}/${s.lines.filter((l) => l.task).length}`)).toEqual([
      'S01:12/8', 'S02:12/8', 'S03:7/5', 'S04:10/5', 'S05:10/7', 'S06:7/6', 'S07:7/6', 'S08:11/7', 'S09:6/5', 'S10:12/4',
      'F01:5/4', 'F02:5/4', 'F03:5/4', 'F04:4/2', 'F05:9/4', 'F06:5/3', 'F07:5/4', 'F08:3/3', 'F09:5/5', 'F10:5/4',
      'N01:6/5', 'N02:61/54', 'N03:8/5', 'N04:5/4', 'N05:3/3',
    ]);
  });
});

describe('bo du lieu danh gia: nhat quan voi bo tach dong that', () => {
  it('moi mau: splitLines cho DUNG so dong va dung noi dung tung dong (nhan vang la so dong nen sai 1 dong la sai het)', () => {
    const wrong: string[] = [];
    for (const s of DATASET) {
      const rl = splitLines(sampleText(s));
      if (rl.length !== s.lines.length) {
        wrong.push(`${s.id}: dataset ${s.lines.length} dong, splitLines ${rl.length}`);
        continue;
      }
      s.lines.forEach((l, i) => {
        const want = normalizeText(l.t).trim();
        if (rl[i]!.raw !== want) wrong.push(`${s.id} dong ${i + 1}: [${rl[i]!.raw}] != [${want}]`);
      });
    }
    expect(wrong).toEqual([]);
  });

  it('dong dau khong co "sp"; sampleText noi dong bang dau cach khi sp, xuong dong khi khong', () => {
    for (const s of DATASET) expect(s.lines[0]!.sp).toBeUndefined();
    expect(sampleText(byId('F01')).split('\n')).toHaveLength(1); // ca doan van xuoi 1 dong that
    expect(sampleText(byId('F04')).split('\n')).toHaveLength(2); // doan 1 + loi cam on
    expect(sampleText(byId('S06')).split('\n')).toHaveLength(7);
    expect(sampleText(byId('F04'))).toContain('nhé. Em Lan chuẩn bị'); // dinh bang dau cach
  });

  it('bullet long (chi tiet cua bullet cha) khong bi tinh la viec; tieu de danh so co bullet con cung khong', () => {
    const s04 = byId('S04');
    expect(s04.lines.map((l) => l.task)).toEqual([false, false, true, false, false, true, true, false, true, true]);
    const s02 = byId('S02');
    expect(s02.lines.filter((l) => /^\d\. /.test(l.t)).every((l) => !l.task)).toBe(true);
    expect(splitLines(sampleText(s04))[3]!.level).toBe(1); // dong 4 that su la bullet thut le
  });
});

describe('bo du lieu danh gia: nhan ngay', () => {
  it('ngay hop le, nam 2026, bat dau <= han, chi gan cho dong la viec', () => {
    for (const s of DATASET) {
      for (const [i, l] of s.lines.entries()) {
        for (const d of [l.start, l.due]) {
          if (d === undefined) continue;
          expect(isValidIso(d), `${s.id} dong ${i + 1}: ${d}`).toBe(true);
          expect(d.startsWith('2026-'), `${s.id} dong ${i + 1}: ${d}`).toBe(true);
          expect(l.task, `${s.id} dong ${i + 1} co ngay nhung khong phai viec`).toBe(true);
        }
        if (l.start !== undefined) {
          expect(l.due, `${s.id} dong ${i + 1} co start ma khong co due`).toBeDefined();
          expect(l.start <= l.due!).toBe(true);
        }
      }
      if (s.projectStart !== undefined) expect(isValidIso(s.projectStart)).toBe(true);
      if (s.projectEnd !== undefined) expect(isValidIso(s.projectEnd)).toBe(true);
      if (s.projectStart !== undefined && s.projectEnd !== undefined) expect(s.projectStart <= s.projectEnd).toBe(true);
    }
  });

  it('ngay tuong doi: nhan vang tinh theo hom nay = Thu Bay 19/09/2026', () => {
    const get = (id: string, i: number) => byId(id).lines[i]!.due;
    expect(get('S09', 1)).toBe('2026-09-20'); // ngay mai
    expect(get('S09', 2)).toBe('2026-09-25'); // thu Sau tuan sau
    expect(get('S09', 5)).toBe('2026-10-03'); // trong 2 tuan nua = +14 ngay
    expect(get('F03', 0)).toBe('2026-09-20'); // sang mai
    expect(get('F03', 1)).toBe('2026-09-25');
    expect(get('F03', 2)).toBe('2026-10-03');
    // cach noi mo ho va thoi luong KHONG duoc gan ngay
    expect(get('F02', 0)).toBeUndefined(); // dau thang 12
    expect(get('F09', 0)).toBeUndefined(); // cuoi thang 10
    expect(byId('N02').lines.find((l) => l.t.includes('trong 1 tuần'))!.due).toBeUndefined();
    expect(byId('N02').lines.find((l) => l.t.includes('sau 1 tháng'))!.due).toBeUndefined();
  });
});

describe('bo du lieu danh gia: dung duoc cho ca bon nhanh', () => {
  it('moi mau du ngan cho AI doc het (<= 6000 ky tu), khong co email/so dien thoai, co it nhat 1 viec', () => {
    for (const s of DATASET) {
      const text = sampleText(s);
      expect(text.length, s.id).toBeLessThanOrEqual(6000);
      expect(text.includes('@'), `${s.id} co @`).toBe(false);
      expect(/\d{9}/.test(text), `${s.id} co day so dai`).toBe(false);
      expect(s.lines.some((l) => l.task), s.id).toBe(true);
      expect(s.note.trim(), s.id).not.toBe('');
    }
    expect(splitLines(sampleText(byId('N02'))).length).toBeGreaterThanOrEqual(60);
  });

  it('co mau "lai" o muc bien cua nguong (S10 ~0,5 va F05 ~0,33) de bang quet nguong co y nghia; nhan do doc chu khong do ti le', () => {
    const ratio = (id: string) => detectMode(splitLines(sampleText(byId(id)))).structuredRatio;
    expect(ratio('S10')).toBeCloseTo(0.5, 5);
    expect(ratio('F05')).toBeCloseTo(3 / 9, 5);
    expect(byId('S10').goldMode).toBe('STRUCTURED');
    expect(byId('F05').goldMode).toBe('FREEFORM');
    // cac mau con lai nam xa hai phia: hoac khong co dong cau truc nao (0), hoac tu 0,67 tro len
    const others = DATASET.filter((s) => s.id !== 'S10' && s.id !== 'F05').map((s) => ratio(s.id));
    expect(others.every((r) => r === 0 || r >= 0.67)).toBe(true);
  });

});
