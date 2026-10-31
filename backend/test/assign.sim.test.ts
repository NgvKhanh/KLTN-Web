// Buoc 2 - bo sinh du lieu mo phong (ASSIGN_MODULE.md §7). Phan nay THUAN: khong cham CSDL.
// (setup.ts van TRUNCATE truoc moi `it`, nen cac ca duoc gop thanh bang cho nhanh.)
//
// Muc dich: chung minh 6 nguon lech co y (chong "vong tron") la THAT chu khong chi nam trong
// comment, va bo du lieu khong tu mau thuan tren nhieu hat giong / cau hinh.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SIM,
  MAX_LATE_DAYS,
  onTimeProbability,
  Rng,
  assignablePool,
  bestCandidate,
  generateSimulation,
  skillAt,
  summarize,
  type SimConfig,
  type SimDataset,
} from '../src/scripts/simGenerator';
import { GENERIC_TITLES, SYNONYMS, TOPICS } from '../src/scripts/simVocab';

// Dong bang: neu bo sinh doi (ke ca doi thu tu goi so ngau nhien) thi ma bam nay doi va test rot.
// Doi ma bam nay co nghia la SO LIEU TRONG LUAN VAN PHAI CHAY LAI - khong duoc sua cho xanh.
const FROZEN_SHA256 = 'e7ddf9ac5a61e70048eab3c8cbcfaaf44b2b4c15d9d90be560086078b591e9d9';

const sha = (d: SimDataset) => createHash('sha256').update(JSON.stringify(d)).digest('hex');

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.freeze(value);
    for (const v of Object.values(value as object)) deepFreeze(v);
  }
  return value;
}

// Moi tieu de "sach" (khong dong nghia, khong loi chinh ta) deu nam trong tap nay.
const CLEAN_TITLES = new Set<string>();
for (const t of TOPICS) {
  for (const verb of t.verbs) {
    for (const obj of t.objects) {
      for (const detail of t.details) CLEAN_TITLES.add(`${verb} ${obj}${detail ? ` ${detail}` : ''}`);
    }
  }
}

const clean: Partial<SimConfig> = { synonymRate: 0, typoRate: 0, ambiguousRate: 0 };
const gen = (over: Partial<SimConfig> = {}) => generateSimulation({ ...DEFAULT_SIM, ...over });

/** Mọi mâu thuẫn nội tại có thể có của một bộ dữ liệu. Rỗng = nhất quán. */
function violations(d: SimDataset): string[] {
  const out: string[] = [];
  const cfg = d.config;
  const people = new Map(d.people.map((p) => [p.key, p]));
  const boards = new Set(d.boards.map((b) => b.key));
  const keys = new Set<string>();

  for (const c of d.cards) {
    const tag = `${c.key}`;
    if (keys.has(c.key)) out.push(`${tag}: trung khoa`);
    keys.add(c.key);
    if (!boards.has(c.boardKey)) out.push(`${tag}: bang khong ton tai`);

    const who = people.get(c.assigneeKey);
    if (!who) {
      out.push(`${tag}: nguoi nhan khong ton tai`);
      continue;
    }
    if (!people.has(c.assignedByKey)) out.push(`${tag}: nguoi giao khong ton tai`);
    if (!assignablePool(d.people, c.assignedDay, c.dueDay).some((p) => p.key === c.assigneeKey)) {
      out.push(`${tag}: nguoi nhan NGOAI ho boi (chua vao / da roi nhom)`);
    }

    if (!(c.createdDay <= c.assignedDay)) out.push(`${tag}: giao truoc khi tao`);
    if (!(c.assignedDay < c.dueDay)) out.push(`${tag}: han khong sau ngay giao`);
    if (c.assignedDay > cfg.days) out.push(`${tag}: giao trong tuong lai`);
    if (c.topic < 0 || c.topic >= TOPICS.length) out.push(`${tag}: chu de ngoai khoang`);
    if (c.secondTopic === c.topic) out.push(`${tag}: chu de phu trung chu de chinh`);

    if (c.done) {
      if (c.completedDay === null) out.push(`${tag}: xong ma khong co ngay xong`);
      else {
        if (c.completedDay < c.assignedDay) out.push(`${tag}: xong truoc khi giao`);
        if (c.completedDay > cfg.days) out.push(`${tag}: xong trong tuong lai`);
        if (who.leftDay !== null && c.completedDay >= who.leftDay) {
          out.push(`${tag}: xong SAU ngay nguoi nhan da roi nhom`);
        }
        if (c.onTime !== c.completedDay <= c.dueDay) out.push(`${tag}: onTime khong khop ngay`);
      }
      if (c.listIndex !== 2) out.push(`${tag}: xong ma khong o cot Hoan thanh`);
    } else {
      if (c.completedDay !== null) out.push(`${tag}: chua xong ma co ngay xong`);
      if (c.onTime) out.push(`${tag}: chua xong ma danh dau dung han`);
      if (c.reopened) out.push(`${tag}: chua xong ma danh dau bi mo lai`);
      if (c.listIndex === 2) out.push(`${tag}: chua xong ma o cot Hoan thanh`);
    }
  }
  return out;
}

describe('Buoc 2 - bo sinh du lieu mo phong: tinh tat dinh va nhat quan', () => {
  it('cung hat giong -> giong het; khac hat giong -> khac; dong bang bang sha256; khong sua dau vao', () => {
    const a = gen();
    expect(sha(a)).toBe(sha(gen()));
    expect(sha(a)).not.toBe(sha(gen({ seed: DEFAULT_SIM.seed + 1 })));
    expect(sha(a)).toBe(FROZEN_SHA256);

    // Dau vao dong bang + ket qua dong bang: ma nao sua dau vao se nem TypeError (module ESM la strict)
    const frozen = deepFreeze(gen());
    expect(() => {
      for (const c of frozen.cards) {
        bestCandidate(frozen.people, c);
        assignablePool(frozen.people, c.assignedDay, c.dueDay);
        for (const p of frozen.people) skillAt(p, c.topic, c.assignedDay);
      }
      summarize(frozen);
    }).not.toThrow();
    expect(() => generateSimulation(deepFreeze({ ...DEFAULT_SIM }))).not.toThrow();
  });

  it('khong co mau thuan noi tai tren 16 hat giong x 3 cau hinh', () => {
    const shapes: Partial<SimConfig>[] = [
      {},
      { people: 3, boards: 2, cardsPerBoard: 10, days: 60 },
      { people: 10, boards: 6, cardsPerBoard: 30, days: 400, wrongAssignRate: 0.5 },
    ];
    // Hat giong sinh bang LCG co dinh -> tai lap duoc
    let s = 42;
    const seeds = Array.from({ length: 16 }, () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s;
    });
    let checked = 0;
    for (const shape of shapes) {
      for (const seed of seeds) {
        const d = gen({ ...shape, seed });
        expect(violations(d), `seed=${seed} shape=${JSON.stringify(shape)}`).toEqual([]);
        expect(d.cards.length).toBeGreaterThan(0);
        checked += 1;
      }
    }
    expect(checked).toBe(48);
  });

  it('cau hinh sai bi tu choi', () => {
    for (const bad of [{ people: 1 }, { boards: 0 }, { cardsPerBoard: 0 }, { days: 29 }]) {
      expect(() => gen(bad), JSON.stringify(bad)).toThrow();
    }
  });

  it('bo so ngau nhien: tat dinh, hat giong 0 khong ket, deu, khong tuong quan', () => {
    const a = new Rng(123);
    const b = new Rng(123);
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));

    // Hat giong 0 la truong hop LCG de ket: phai van sinh ra cac gia tri khac nhau
    const z = new Rng(0);
    expect(new Set(Array.from({ length: 50 }, () => z.next())).size).toBe(50);

    const r = new Rng(20260920);
    const n = 100_000;
    const xs = Array.from({ length: n }, () => r.next());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    const mean = xs.reduce((p, q) => p + q, 0) / n;
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(xs.filter((x) => x < 0.55).length / n - 0.55)).toBeLessThan(0.01);
    // Tuong quan lien tiep gan 0
    const v = xs.reduce((p, q) => p + (q - mean) ** 2, 0) / n;
    let cov = 0;
    for (let i = 0; i + 1 < n; i += 1) cov += (xs[i]! - mean) * (xs[i + 1]! - mean);
    expect(Math.abs(cov / (n - 1) / v)).toBeLessThan(0.01);
    // int() luon trong [0,n) va khong bao gio ra n
    const q = new Rng(5);
    for (let i = 0; i < 5000; i += 1) {
      const k = q.int(7);
      expect(k).toBeGreaterThanOrEqual(0);
      expect(k).toBeLessThan(7);
    }
    expect(() => q.pick([])).toThrow();
    // weighted: trong so 0 khong bao gio duoc chon; tong 0 thi chon deu thay vi nem loi
    const w = new Rng(9);
    for (let i = 0; i < 2000; i += 1) expect(w.weighted(['a', 'b', 'c'], [0, 1, 0])).toBe('b');
    expect(['a', 'b']).toContain(w.weighted(['a', 'b'], [0, 0]));
    expect(['a', 'b']).toContain(w.weighted(['a', 'b'], [-1, Number.NaN]));
  });
});

describe('Buoc 2 - sau nguon lech co y (chong "vong tron") deu do duoc', () => {
  it('nguon 1: tu dong nghia / viet tat', () => {
    // Khong dong nghia -> moi tieu de nam nguyen trong tu vung
    const plain = gen({ ...clean }).cards;
    expect(plain.every((c) => CLEAN_TITLES.has(c.title))).toBe(true);
    const phrases = Object.keys(SYNONYMS);
    // ... va co du cum tu co the bi thay (neu khong thi ca phep thu ben duoi vo nghia)
    expect(plain.filter((c) => phrases.some((p) => c.title.includes(p))).length).toBeGreaterThan(20);

    // Ep 100% -> KHONG con cum goc nao sot lai, va tieu de khong con nam trong tu vung sach
    const forced = gen({ ...clean, synonymRate: 1 }).cards;
    expect(forced.some((c) => phrases.some((p) => c.title.includes(p)))).toBe(false);
    expect(forced.filter((c) => !CLEAN_TITLES.has(c.title)).length).toBeGreaterThan(20);
    // Mac dinh co dong nghia xen ke nhung khong phai tat ca
    const mixed = gen().cards.filter((c) => !c.ambiguous);
    const changed = mixed.filter((c) => !CLEAN_TITLES.has(c.title)).length;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThan(mixed.length);
  });

  it('nguon 2: loi chinh ta', () => {
    const forced = gen({ ...clean, typoRate: 1 }).cards;
    const broken = forced.filter((c) => !CLEAN_TITLES.has(c.title)).length;
    expect(broken / forced.length).toBeGreaterThan(0.6);
    // Khong loi thi khong co tieu de nao bi hong
    expect(gen({ ...clean }).cards.filter((c) => !CLEAN_TITLES.has(c.title))).toEqual([]);
  });

  it('nguon 3: the mo ho khong lo chu de', () => {
    const all = gen({ ambiguousRate: 1 }).cards;
    expect(all.every((c) => c.ambiguous && GENERIC_TITLES.includes(c.title))).toBe(true);
    const none = gen({ ambiguousRate: 0 }).cards;
    expect(none.some((c) => c.ambiguous || GENERIC_TITLES.includes(c.title))).toBe(false);
    const share = summarize(gen()).ambiguousRate;
    expect(share).toBeGreaterThan(0.03);
    expect(share).toBeLessThan(0.3);
    // The mo ho van co chu de an (de cham diem o buoc 7): tieu de khong noi len dieu do
    expect(all.every((c) => c.topic >= 0 && c.topic < TOPICS.length)).toBe(true);
  });

  it('nguon 4: phan cong lich su SAI mot phan - lich su khong phai la dap an', () => {
    const right = summarize(gen({ wrongAssignRate: 0 })).optimalAssignRate;
    const wrong = summarize(gen({ wrongAssignRate: 1 })).optimalAssignRate;
    const dflt = summarize(gen()).optimalAssignRate;
    expect(right - wrong).toBeGreaterThan(0.25);
    // Mac dinh: khong gan 1 (neu ~1 thi lich su chinh la dap an, bai toan tam thuong)
    // va khong gan muc doan mo (6 nguoi -> ~0.17)
    expect(dflt).toBeGreaterThan(0.3);
    expect(dflt).toBeLessThan(0.75);
    // Ngay ca khi 0% giao sai, van co giao cho nguoi khong phai gioi nhat (chon theo xac suat)
    expect(right).toBeLessThan(0.95);
  });

  it('nguon 5: ky nang thay doi theo thoi gian (nguoi hoc nghe)', () => {
    const all = gen({ learnerRate: 1 });
    for (const p of all.people) {
      const topics = p.learning.map((x, i) => [i, x] as const).filter(([, x]) => x > 0);
      expect(topics.length, p.key).toBe(1);
      const [t] = topics[0]!;
      const start = skillAt(p, t, p.joinedDay);
      const end = skillAt(p, t, all.config.days);
      expect(end - start, p.key).toBeGreaterThanOrEqual(0.29);
      // Tang dan, khong nhay coc
      let prev = -1;
      for (let day = p.joinedDay; day <= all.config.days; day += 10) {
        const s = skillAt(p, t, day);
        expect(s).toBeGreaterThanOrEqual(prev);
        prev = s;
      }
      // Truoc khi tham gia khong co ky nang (khong phai ung vien)
      if (p.joinedDay > 0) expect(skillAt(p, t, p.joinedDay - 1)).toBe(0);
    }
    for (const p of gen({ learnerRate: 0 }).people) {
      expect(p.learning.every((x) => x === 0)).toBe(true);
      expect(skillAt(p, 0, p.joinedDay)).toBe(skillAt(p, 0, DEFAULT_SIM.days));
    }
    // Ky nang luon trong [0,1]
    for (const p of all.people) {
      for (let t = 0; t < TOPICS.length; t += 1) {
        for (const day of [0, 100, 300]) {
          const s = skillAt(p, t, day);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(s).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('nguon 6: dung han theo XAC SUAT - khong phai "hop thi luon dung han"', () => {
    const rows: { skill: number; onTime: boolean }[] = [];
    for (let seed = 1; seed <= 8; seed += 1) {
      const d = gen({ seed });
      for (const c of d.cards.filter((x) => x.done)) {
        const who = d.people.find((p) => p.key === c.assigneeKey)!;
        rows.push({ skill: skillAt(who, c.topic, c.assignedDay), onTime: c.onTime });
      }
    }
    const rate = (xs: typeof rows) => xs.filter((r) => r.onTime).length / xs.length;
    const hi = rows.filter((r) => r.skill >= 0.6);
    const lo = rows.filter((r) => r.skill < 0.3);
    expect(hi.length).toBeGreaterThan(100);
    expect(lo.length).toBeGreaterThan(100);
    // Ky nang co anh huong that ...
    expect(rate(hi) - rate(lo)).toBeGreaterThan(0.25);
    // ... nhung khong quyet dinh tuyet doi: nguoi gioi van tre, nguoi yeu van dung han
    expect(rate(hi)).toBeLessThan(0.9);
    expect(rate(lo)).toBeGreaterThan(0.05);
  });
});

describe('Buoc 2 - cau truc nhom: nguoi moi, nguoi nghi, tai hien tai', () => {
  it('nguoi vao muon khong co lich su truoc do; nguoi nghi khong nhan viec keo qua ngay nghi; co the dang mo', () => {
    const d = gen();
    const people = new Map(d.people.map((p) => [p.key, p]));

    const late = d.people[d.people.length - 1]!;
    expect(late.joinedDay).toBeGreaterThan(d.config.days * 0.4);
    expect(d.cards.filter((c) => c.assigneeKey === late.key).every((c) => c.assignedDay >= late.joinedDay)).toBe(true);
    expect(d.cards.some((c) => c.assigneeKey === late.key)).toBe(true);

    const leaver = d.people[d.people.length - 2]!;
    expect(leaver.leftDay).not.toBeNull();
    const theirs = d.cards.filter((c) => c.assigneeKey === leaver.key);
    expect(theirs.length).toBeGreaterThan(0);
    for (const c of theirs) {
      expect(c.assignedDay + 0).toBeLessThan(leaver.leftDay!);
      if (c.completedDay !== null) expect(c.completedDay).toBeLessThan(leaver.leftDay!);
      expect(c.dueDay + MAX_LATE_DAYS).toBeLessThan(leaver.leftDay!);
    }
    // Moi nguoi khac van dang lam den het lich su
    expect(d.people.filter((p) => p.leftDay === null).length).toBe(d.people.length - 1);

    // Co the dang mo (de cham "kha dung" co y nghia), tap trung o du an dang chay
    const open = d.cards.filter((c) => !c.done);
    expect(open.length).toBeGreaterThanOrEqual(5);
    const current = d.boards[d.boards.length - 1]!;
    expect(open.every((c) => c.boardKey === current.key)).toBe(true);
    expect(current.endDay).toBe(d.config.days);

    // Nguoi giao viec luon la chu nhom (p1); chu nhom nhan viec thi la TU NHAN. Kiem DOC LAP voi
    // simSeed (ben do tu suy `self` tu chinh bo du lieu nen se khop du bo sinh doi hanh vi).
    const boss = d.people[0]!;
    expect(d.cards.every((c) => c.assignedByKey === boss.key)).toBe(true);
    expect(d.cards.filter((c) => c.assigneeKey === boss.key).length).toBeGreaterThan(0);
    expect(d.cards.filter((c) => c.assigneeKey !== boss.key).length).toBeGreaterThan(0);

    // Dinh danh
    expect(new Set(d.people.map((p) => p.email)).size).toBe(d.people.length);
    expect(d.people.every((p) => p.email.endsWith('@sim.local') && people.has(p.key))).toBe(true);
    // Moi chu de co it nhat mot the, va moi nguoi la dap an tot nhat cua it nhat mot the
    expect(new Set(d.cards.map((c) => c.topic)).size).toBe(TOPICS.length);
    expect(new Set(d.cards.map((c) => bestCandidate(d.people, c).key)).size).toBe(d.people.length);
  });

  it('chia bai chu de: moi chu de deu xuat hien o it nhat mot du an tren 16 hat giong (khong de sot chu de)', () => {
    // Boc ngau nhien tung bang tung lam chu de 1 chi co 1/120 the -> nguoi manh chu de do khong bao
    // gio la dap an dung. Chia bai tu mot co da xao dam bao moi chu de co mat.
    let s = 99;
    for (let i = 0; i < 16; i += 1) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      const d = gen({ seed: s });
      const themes = new Set(d.boards.flatMap((b) => b.themes));
      expect([...themes].sort(), `seed=${s}`).toEqual(TOPICS.map((_, t) => t));
      // Moi bang co dung 3 chu de khac nhau
      for (const b of d.boards) expect(new Set(b.themes).size, `${b.key} seed=${s}`).toBe(3);
    }
  });

  it('onTimeProbability: tang theo ky nang, khong phat tai <= nua suc chua, phat 0,06/the vuot nua, kep [0,05; 0,95]', () => {
    // So tinh tay: 0,15 + 0,7 x ky nang - 0,06 x max(0, tai - suc chua/2)
    expect(onTimeProbability(0.5, 0, 4)).toBeCloseTo(0.5, 12);
    expect(onTimeProbability(0.5, 2, 4)).toBeCloseTo(0.5, 12); // tai = nua suc chua: chua phat
    expect(onTimeProbability(0.5, 3, 4)).toBeCloseTo(0.44, 12);
    expect(onTimeProbability(0.5, 6, 4)).toBeCloseTo(0.5 - 0.06 * 4, 12);
    expect(onTimeProbability(1, 0, 4)).toBeCloseTo(0.85, 12);
    expect(onTimeProbability(0, 0, 4)).toBeCloseTo(0.15, 12);
    // Kep duoi: tai rat nang, ky nang 0
    expect(onTimeProbability(0, 20, 4)).toBe(0.05);
    expect(onTimeProbability(0.2, 30, 3)).toBe(0.05);
    // Don dieu: tang theo ky nang, giam theo tai; luon trong [0,05; 0,95]
    for (let cap = 1; cap <= 6; cap += 1) {
      for (let load = 0; load <= 12; load += 1) {
        let prev = -1;
        for (let k = 0; k <= 10; k += 1) {
          const p = onTimeProbability(k / 10, load, cap);
          expect(p).toBeGreaterThanOrEqual(0.05);
          expect(p).toBeLessThanOrEqual(0.95);
          expect(p).toBeGreaterThanOrEqual(prev);
          prev = p;
        }
        expect(onTimeProbability(0.6, load + 1, cap)).toBeLessThanOrEqual(onTimeProbability(0.6, load, cap));
      }
    }
  });

  it('dap an tot nhat: nguoi co ky nang cao nhat trong ho boi, hoa thi lay khoa nho hon', () => {
    const d = gen();
    for (const c of d.cards) {
      const best = bestCandidate(d.people, c);
      const pool = assignablePool(d.people, c.assignedDay, c.dueDay);
      const max = Math.max(...pool.map((p) => skillAt(p, c.topic, c.assignedDay)));
      expect(best.skill).toBeCloseTo(max, 12);
      expect(pool.some((p) => p.key === best.key)).toBe(true);
    }
    // Hoa diem -> khoa nho hon thang, khong phu thuoc thu tu mang
    const c = d.cards[0]!;
    const a = { ...d.people[0]!, key: 'z', skills: d.people[0]!.skills.map(() => 0.5), learning: d.people[0]!.learning.map(() => 0), joinedDay: 0, leftDay: null };
    const b = { ...a, key: 'a' };
    expect(bestCandidate([a, b], c).key).toBe('a');
    expect(bestCandidate([b, a], c).key).toBe('a');
  });
});
