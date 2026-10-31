// Dung bao cao cho cac thi nghiem cua buoc 7b (evalAssignExperiments.ts): bang quet tham so, luoi trong so, the gioi, do ben,
// hoc trong so, duong hoi tu (CSV + SVG) va bang xu ly van ban. TOAN HAM THUAN: nhan ket qua da chay, tra ve chuoi -> test duoc.
// Dung lai dinh dang / ket luan cua evalAssignReport.ts (cung mot cach doc khoang tin cay).

import { fmt, fmtPct, mdTable } from './evalMetrics';
import { bootstrapMeanCI, comparePaired, mean, type PairedComparison } from './evalAssignStats';
import { fmtDiff, fmtMeanCI, provenanceLines, verdict, type ReportMeta } from './evalAssignReport';
import type { LearningResult, ObjectiveResult, SweepResult, TextResult } from './evalAssignExperiments';
import { PERSONAS } from './evalAssignLeader';
import type { RunSummary } from './evalAssignRun';

type Getter = (s: RunSummary) => number | null;

const nums = (rows: readonly RunSummary[], get: Getter): number[] => rows.map(get).filter((x): x is number => x !== null);

const avg = (xs: number[]): number | null => (xs.length === 0 ? null : mean(xs));

/** Gom cac ket qua theo `group`, giu thu tu xuat hien dau tien. */
export function groupResults<T extends { group: string }>(results: readonly T[]): [string, T[]][] {
  const map = new Map<string, T[]>();
  for (const r of results) {
    const list = map.get(r.group);
    if (list) list.push(r);
    else map.set(r.group, [r]);
  }
  return [...map.entries()];
}

/** Chenh lech CAP `a - b` cua mot chi so; null neu khong cung the gioi hoac thieu du lieu (khong so sanh xuyen the gioi). */
export function pairedDiff(a: SweepResult, b: SweepResult, get: Getter): PairedComparison | null {
  if (a.world !== b.world) return null;
  if (a.perSeed.length !== b.perSeed.length || a.perSeed.length < 2) return null;
  const xa = a.perSeed.map(get);
  const xb = b.perSeed.map(get);
  if (xa.some((x) => x === null) || xb.some((x) => x === null)) return null;
  return comparePaired(xa as number[], xb as number[]);
}

export interface SweepTableOptions {
  /** Them cot chenh lech cap so voi mot dong khac trong nhom (vd "Ngau nhien"). */
  against?: { header: string; label: string }[];
}

const pOn: Getter = (s) => s.pOnTime;

/** Bang cua MOT nhom: chi so chinh kem chenh lech cap so voi diem mac dinh cua nhom (va cac dong tham chieu neu co). */
export function sweepGroupTable(rows: readonly SweepResult[], opts: SweepTableOptions = {}): string {
  const base = rows.find((r) => r.isDefault);
  const extra = (opts.against ?? []).map((a) => ({ ...a, row: rows.find((r) => r.label === a.label) }));
  const cell = (r: SweepResult, ref: SweepResult | undefined): string => {
    if (!ref || ref === r) return '–';
    const p = pairedDiff(r, ref, pOn);
    return p === null ? '–' : `${fmtDiff(p)} — ${verdict(p, true)}`;
  };
  const table = rows.map((r) => [
    r.label,
    fmtMeanCI(nums(r.perSeed, pOn)),
    cell(r, base),
    ...extra.map((e) => cell(r, e.row)),
    fmt(avg(nums(r.perSeed, (s) => s.regret)), 3),
    fmtPct(avg(nums(r.perSeed, (s) => s.top1))),
    fmt(avg(nums(r.perSeed, (s) => s.giniAssigned)), 3),
    fmt(avg(nums(r.perSeed, (s) => s.newcomerParity)), 2),
    fmtPct(avg(nums(r.perSeed, (s) => s.topNoHistory))),
  ]);
  return mdTable(
    [
      'Giá trị',
      'P(đúng hạn) [95% CI]',
      base ? `Δ so với mặc định (${base.label})` : 'Δ so với mặc định',
      ...extra.map((e) => e.header),
      'Hối tiếc',
      'Top-1',
      'Gini',
      'Người mới',
      'Người mới dẫn đầu',
    ],
    table
  );
}

/** Nhieu bang, moi nhom mot bang, tieu de cap `level`. */
export function sweepSections(results: readonly SweepResult[], opts: SweepTableOptions = {}, level = 3): string {
  const out: string[] = [];
  for (const [group, rows] of groupResults(results)) {
    out.push(`${'#'.repeat(level)} ${group}`, '', sweepGroupTable(rows, opts), '');
  }
  return out.join('\n');
}

/** Nhan TRUNG TINH theo khoang tin cay (khong "tot / xau"): dung cho chi so khong co chieu tot hon ro rang. */
const side = (c: PairedComparison): string => (c.lo > 0 ? 'cao hơn mặc định' : c.hi < 0 ? 'thấp hơn mặc định' : 'chưa phân biệt được');

/**
 * Chenh lech CAP (cung the, cung may rui) cua "Nguoi moi" va Gini so voi dong mac dinh cua nhom: bang chinh chi hien trung binh cua hai
 * chi so nay, ma chi so "Nguoi moi" rat nhieu giua cac hat giong nen hai trung binh cach nhau khong du de ket luan. Tra ve '' neu nhom
 * khong co dong mac dinh.
 */
export function newcomerDeltaLines(rows: readonly SweepResult[]): string {
  const base = rows.find((r) => r.isDefault);
  if (!base) return '';
  const delta = (r: SweepResult, get: Getter): string => {
    const p = pairedDiff(r, base, get);
    return p === null ? '–' : `${fmtDiff(p)} — ${side(p)}`;
  };
  const lines = rows
    .filter((r) => r !== base)
    .map((r) => `- ${r.label}: Δ Người mới ${delta(r, (s) => s.newcomerParity)} · Δ Gini ${delta(r, (s) => s.giniAssigned)}`);
  return [
    `Chênh lệch cặp so với mặc định (${base.label}), cùng thẻ cùng may rủi, [95% CI] (nhãn chỉ nói khoảng có chứa 0 hay không, không phán tốt / xấu):`,
    '',
    ...lines,
  ].join('\n');
}

/** Bang xep hang cua luoi trong so: top `top` cau hinh theo P(dung han) va vi tri cua cau hinh mac dinh. */
export function weightsGridTable(rows: readonly SweepResult[], top = 8): string {
  const base = rows.find((r) => r.isDefault);
  const scored = rows.map((r) => ({ r, p: avg(nums(r.perSeed, pOn)) ?? -1 })).sort((a, b) => b.p - a.p);
  const rankOfDefault = base ? scored.findIndex((s) => s.r === base) + 1 : null;
  const shown = scored.slice(0, top);
  if (base && !shown.some((s) => s.r === base)) shown.push(scored[rankOfDefault! - 1]!);
  const table = shown.map((s) => {
    const d = base && s.r !== base ? pairedDiff(s.r, base, pOn) : null;
    return [
      scored.indexOf(s) + 1,
      s.r.label,
      fmtMeanCI(nums(s.r.perSeed, pOn)),
      d ? `${fmtDiff(d)} — ${verdict(d, true)}` : '–',
      fmtPct(avg(nums(s.r.perSeed, (x) => x.top1))),
      fmt(avg(nums(s.r.perSeed, (x) => x.giniAssigned)), 3),
      fmt(avg(nums(s.r.perSeed, (x) => x.newcomerParity)), 2),
    ];
  });
  const head = `Xếp theo P(đúng hạn) giảm dần; cấu hình mặc định đứng hạng ${rankOfDefault ?? '–'}/${rows.length}.`;
  return (
    head +
    '\n\n' +
    mdTable(['Hạng', 'Trọng số', 'P(đúng hạn) [95% CI]', 'Δ so với mặc định', 'Top-1', 'Gini', 'Người mới'], table)
  );
}

const ROBUST_IDS = ['Ngẫu nhiên', 'Người rảnh nhất', 'Chỉ kinh nghiệm', 'Đầy đủ, trọng số cố định'];

/** Bang do ben: moi dong mot the gioi, cac cot la P(dung han) trung binh cua tung nhanh + chenh lech cap cua nhanh day du. */
export function robustnessTable(results: readonly SweepResult[]): string {
  const rows = groupResults(results).map(([group, rs]) => {
    const by = (label: string) => rs.find((r) => r.label === label);
    const full = by('Đầy đủ, trọng số cố định');
    const rnd = by('Ngẫu nhiên');
    const exp = by('Chỉ kinh nghiệm');
    const means = ROBUST_IDS.map((l) => {
      const r = by(l);
      return r ? avg(nums(r.perSeed, pOn)) : null;
    });
    const order = ROBUST_IDS.map((l, i) => ({ l, m: means[i] }))
      .filter((x): x is { l: string; m: number } => x.m !== null)
      .sort((a, b) => b.m - a.m)
      .map((x) => x.l.replace('Đầy đủ, trọng số cố định', 'Đầy đủ').replace('Người rảnh nhất', 'Rảnh nhất').replace('Chỉ kinh nghiệm', 'Kinh nghiệm'))
      .join(' > ');
    const diff = (a: SweepResult | undefined, b: SweepResult | undefined) => {
      if (!a || !b) return '–';
      const p = pairedDiff(a, b, pOn);
      return p === null ? '–' : `${fmtDiff(p)} — ${verdict(p, true)}`;
    };
    return [group, ...means.map((m) => fmt(m, 3)), diff(full, rnd), diff(full, exp), order];
  });
  return mdTable(
    ['Thế giới', ...ROBUST_IDS.map((l) => `P(đúng hạn) ${l}`), 'Đầy đủ − Ngẫu nhiên', 'Đầy đủ − Chỉ kinh nghiệm', 'Thứ hạng'],
    rows
  );
}

// ---------- Hoc trong so ----------

export const CHECKPOINTS: readonly number[] = [0, 10, 20, 40, 80, 100];

/** Khoang cach L1 o moi moc t cua cac hat giong con du quyet dinh (t = so quyet dinh da qua; 0 = luc ban dau). */
export function distanceAt(runs: readonly { trace: { distance: number[] } }[], t: number): number[] {
  return runs.filter((r) => t < r.trace.distance.length).map((r) => r.trace.distance[t]!);
}

function meanOrDash(xs: number[], digits = 2): string {
  return xs.length === 0 ? '–' : fmt(mean(xs), digits);
}

/** Bang duong hoi tu: khoang cach L1 tu trong so hoc duoc toi gu cua truong nhom tai cac moc, khoang cach cuoi, so luot hoc. */
export function learningTable(results: readonly LearningResult[]): string {
  const rows = results.map((r) => {
    const finals = r.learned.map((x) => x.trace.distance[x.trace.distance.length - 1]!);
    return [
      `${PERSONAS[r.point.persona].label}`,
      String(r.point.noise).replace('.', ','),
      CHECKPOINTS.map((t) => meanOrDash(distanceAt(r.learned, t))).join(' → '),
      fmtMeanCI(finals, 2),
      fmt(avg(r.learned.map((x) => x.stats.learned)), 1),
    ];
  });
  return mdTable(
    [
      'Gu của trưởng nhóm',
      'Nhiễu',
      `Khoảng cách L1 tới gu (${CHECKPOINTS.join(' / ')} quyết định)`,
      'Khoảng cách cuối [95% CI]',
      'Số lượt học',
    ],
    rows
  );
}

const arrow = (a: number | null, b: number | null) => `${fmtPct(a)} → ${fmtPct(b)}`;

/** Trung binh bo cac hat giong khong co gia tri (null). */
function avgNonNull(xs: readonly (number | null)[]): number | null {
  const ys = xs.filter((x): x is number => x !== null);
  return ys.length === 0 ? null : mean(ys);
}

/**
 * Bang ti le chap nhan (nguoi xep dau trung lua chon cua truong nhom): tren MOI quyet dinh, va rieng tren cac quyet dinh ma MOI ung
 * vien deu du ba thanh phan (mau so chung cua hai nhanh - tach ra vi nguoi moi chua co lich su bi goi y dai dang lam ti le chung
 * thap bat ke viec hoc), kem chenh lech cap hoc - co dinh tren mau so do o ba phan cuoi, va ti le nguoi moi dung dau.
 */
export function acceptanceTable(results: readonly LearningResult[]): string {
  const rows = results.map((r) => {
    const pairs = r.learned
      .map((x, i) => [x.trace.acceptLastThirdComplete, r.fixed[i]!.acceptLastThirdComplete] as const)
      .filter((p): p is readonly [number, number] => p[0] !== null && p[1] !== null);
    const d = pairs.length >= 2 ? comparePaired(pairs.map((p) => p[0]), pairs.map((p) => p[1])) : null;
    const f = r.fixed;
    const l = r.learned.map((x) => x.trace);
    return [
      PERSONAS[r.point.persona].label,
      String(r.point.noise).replace('.', ','),
      arrow(avg(f.map((t) => t.acceptFirstThird)), avg(f.map((t) => t.acceptLastThird))),
      arrow(avg(l.map((t) => t.acceptFirstThird)), avg(l.map((t) => t.acceptLastThird))),
      arrow(avgNonNull(f.map((t) => t.acceptFirstThirdComplete)), avgNonNull(f.map((t) => t.acceptLastThirdComplete))),
      arrow(avgNonNull(l.map((t) => t.acceptFirstThirdComplete)), avgNonNull(l.map((t) => t.acceptLastThirdComplete))),
      d ? `${fmtDiff(d)} — ${verdict(d, true)}` : '–',
      `${fmtPct(avg(f.map((t) => t.newcomerTopLastThird)))} / ${fmtPct(avg(l.map((t) => t.newcomerTopLastThird)))}`,
    ];
  });
  return mdTable(
    [
      'Gu của trưởng nhóm',
      'Nhiễu',
      'Mọi quyết định: cố định (ba đầu → ba cuối)',
      'Mọi quyết định: có học',
      'Chỉ quyết định đủ dữ liệu: cố định',
      'Chỉ quyết định đủ dữ liệu: có học',
      'Δ đủ dữ liệu (ba cuối) học − cố định',
      'Người xếp đầu là người mới (ba cuối): cố định / có học',
    ],
    rows
  );
}

/** Bang quet toc do hoc: moi (gu, nhieu) mot khoi, moi eta mot dong. */
export function etaTable(results: readonly LearningResult[]): string {
  const rows = results.map((r) => {
    const finals = r.learned.map((x) => x.trace.distance[x.trace.distance.length - 1]!);
    return [
      PERSONAS[r.point.persona].label,
      String(r.point.noise).replace('.', ','),
      String(r.point.eta).replace('.', ','),
      fmtMeanCI(finals, 2),
      fmt(avg(r.learned.map((x) => x.stats.learned)), 1),
      fmtPct(avgNonNull(r.learned.map((x) => x.trace.acceptLastThirdComplete))),
      fmtPct(avgNonNull(r.fixed.map((x) => x.acceptLastThirdComplete))),
    ];
  });
  return mdTable(
    [
      'Gu của trưởng nhóm',
      'Nhiễu',
      'eta',
      'Khoảng cách cuối [95% CI]',
      'Số lượt học',
      'Chấp nhận ba cuối (đủ dữ liệu): có học',
      'Chấp nhận ba cuối (đủ dữ liệu): cố định',
    ],
    rows
  );
}

export interface CurvePoint {
  t: number;
  mean: number;
  lo: number;
  hi: number;
  n: number;
}
export interface CurveSeries {
  label: string;
  points: CurvePoint[];
}

/** Duong hoi tu trung binh cua mot ket qua hoc, kem khoang tin cay bootstrap theo hat giong tai moi t (bo t co < 2 hat giong). */
export function convergenceSeries(result: LearningResult, label: string, step = 2, resamples = 1000): CurveSeries {
  const maxT = Math.max(...result.learned.map((x) => x.trace.distance.length - 1));
  const points: CurvePoint[] = [];
  for (let t = 0; t <= maxT; t += step) {
    const xs = distanceAt(result.learned, t);
    if (xs.length < 2) continue;
    const ci = bootstrapMeanCI(xs, { resamples });
    points.push({ t, mean: ci.mean, lo: ci.lo, hi: ci.hi, n: xs.length });
  }
  return { label, points };
}

export function convergenceCsv(series: readonly CurveSeries[]): string {
  const lines = ['nhom,t,trung_binh,can_duoi,can_tren,so_hat_giong'];
  for (const s of series) {
    const label = `"${s.label.replace(/"/g, '""')}"`;
    for (const p of s.points) lines.push(`${label},${p.t},${p.mean.toFixed(6)},${p.lo.toFixed(6)},${p.hi.toFixed(6)},${p.n}`);
  }
  return lines.join('\n') + '\n';
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PALETTE = ['#1b6ca8', '#d1495b', '#2a9d8f', '#8a6d00', '#6a4c93', '#555555'];

/** Bieu do duong hoi tu dang SVG (dan duoc vao Word / trinh duyet): trung binh + dai tin cay 95%. */
export function convergenceSvg(series: readonly CurveSeries[], title = 'Đường hội tụ của trọng số học được'): string {
  const W = 760;
  const H = 440;
  const m = { l: 64, r: 24, t: 56, b: 64 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) throw new RangeError('khong co diem nao de ve');
  const maxX = Math.max(...all.map((p) => p.t), 1);
  const yTop = Math.max(0.2, Math.ceil(Math.max(...all.map((p) => p.hi)) * 5) / 5);
  const x = (t: number) => m.l + (t / maxX) * pw;
  const y = (v: number) => m.t + ph - (v / yTop) * ph;
  const f = (n: number) => n.toFixed(1);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="Segoe UI, Arial, sans-serif">`);
  out.push(`<title>${escapeXml(title)}</title>`);
  out.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  out.push(`<text x="${W / 2}" y="26" text-anchor="middle" font-size="16" font-weight="600" fill="#222">${escapeXml(title)}</text>`);
  // Luoi va truc y
  for (let i = 0; i <= 5; i += 1) {
    const v = (yTop * i) / 5;
    out.push(`<line x1="${m.l}" y1="${f(y(v))}" x2="${W - m.r}" y2="${f(y(v))}" stroke="#e3e3e3"/>`);
    out.push(`<text x="${m.l - 8}" y="${f(y(v) + 4)}" text-anchor="end" font-size="12" fill="#444">${v.toFixed(2).replace('.', ',')}</text>`);
  }
  // Truc x
  const step = maxX <= 60 ? 10 : 20;
  for (let t = 0; t <= maxX; t += step) {
    out.push(`<line x1="${f(x(t))}" y1="${m.t + ph}" x2="${f(x(t))}" y2="${m.t + ph + 5}" stroke="#444"/>`);
    out.push(`<text x="${f(x(t))}" y="${m.t + ph + 20}" text-anchor="middle" font-size="12" fill="#444">${t}</text>`);
  }
  out.push(`<line x1="${m.l}" y1="${m.t + ph}" x2="${W - m.r}" y2="${m.t + ph}" stroke="#444"/>`);
  out.push(`<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t + ph}" stroke="#444"/>`);
  out.push(`<text x="${m.l + pw / 2}" y="${H - 22}" text-anchor="middle" font-size="13" fill="#222">Số quyết định (lượt phản hồi của trưởng nhóm)</text>`);
  out.push(`<text transform="translate(18 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="13" fill="#222">Khoảng cách L1 tới gu của trưởng nhóm</text>`);
  // Dai tin cay + duong trung binh
  series.forEach((s, i) => {
    if (s.points.length === 0) return;
    const c = PALETTE[i % PALETTE.length]!;
    const upper = s.points.map((p) => `${f(x(p.t))},${f(y(p.hi))}`);
    const lower = [...s.points].reverse().map((p) => `${f(x(p.t))},${f(y(p.lo))}`);
    out.push(`<polygon points="${[...upper, ...lower].join(' ')}" fill="${c}" fill-opacity="0.14" stroke="none"/>`);
    out.push(`<polyline points="${s.points.map((p) => `${f(x(p.t))},${f(y(p.mean))}`).join(' ')}" fill="none" stroke="${c}" stroke-width="2.2"/>`);
  });
  // Chu giai
  series.forEach((s, i) => {
    const c = PALETTE[i % PALETTE.length]!;
    const ly = m.t + 8 + i * 18;
    out.push(`<line x1="${W - m.r - 250}" y1="${ly}" x2="${W - m.r - 226}" y2="${ly}" stroke="${c}" stroke-width="2.6"/>`);
    out.push(`<text x="${W - m.r - 220}" y="${ly + 4}" font-size="12" fill="#222">${escapeXml(s.label)}</text>`);
  });
  out.push('</svg>');
  return out.join('\n');
}

// ---------- Xu ly van ban ----------

/** Bang bi-gram / trong so tieu de: top-1 va P@5 (lang gieng gan nhat cung chu de an) kem chenh lech cap so voi mac dinh. */
export function textTable(results: readonly TextResult[]): string {
  const base = results.find((r) => r.isDefault);
  const col = (r: TextResult, key: 'top1' | 'p5') => r.perSeed.map((x) => x[key]);
  const diff = (r: TextResult, key: 'top1' | 'p5') => {
    if (!base || r === base) return '–';
    const p = comparePaired(col(r, key), col(base, key));
    return `${fmtDiff(p, 4)} — ${verdict(p, true)}`;
  };
  const rows = results.map((r) => [
    r.label,
    `${fmtPct(mean(col(r, 'top1')))}`,
    diff(r, 'top1'),
    `${fmtPct(mean(col(r, 'p5')))}`,
    diff(r, 'p5'),
  ]);
  return mdTable(['Biến thể', 'Top-1', 'Δ top-1 so với mặc định', 'P@5', 'Δ P@5 so với mặc định'], rows);
}

// ---------- Anh huong khach quan cua viec hoc ----------

/**
 * Bang anh huong KHACH QUAN: nhanh co hoc tu giao nguoi xep dau theo trong so da hoc tu gu cua truong nhom, so voi nhanh co dinh.
 * Khong ket luan "hoc lam tot hon" chi vi trong so bam theo gu - gu cua truong nhom gia la tuy y, khong biet ky nang an.
 */
export function objectiveTable(results: readonly ObjectiveResult[]): string {
  const rows = results.map((r) => {
    const p = comparePaired(nums(r.learned, pOn), nums(r.fixed, pOn));
    const g = comparePaired(nums(r.learned, (s) => s.regret), nums(r.fixed, (s) => s.regret));
    const w = (k: 'experience' | 'reliability' | 'availability') => fmt(mean(r.finals.map((x) => x[k])), 2);
    return [
      PERSONAS[r.persona].label,
      String(r.noise).replace('.', ','),
      `${w('experience')} / ${w('reliability')} / ${w('availability')}`,
      fmtMeanCI(nums(r.learned, pOn)),
      fmtMeanCI(nums(r.fixed, pOn)),
      `${fmtDiff(p)} — ${verdict(p, true)}`,
      `${fmtDiff(g)} — ${verdict(g, false)}`,
    ];
  });
  return mdTable(
    [
      'Gu của trưởng nhóm',
      'Nhiễu',
      'Trọng số học được TB (kn / tc / kd)',
      'P(đúng hạn): có học',
      'P(đúng hạn): cố định',
      'Δ P(đúng hạn) học − cố định',
      'Δ hối tiếc học − cố định',
    ],
    rows
  );
}

// ---------- Bao cao 7b ----------

export interface SweepReportInput {
  meta: ReportMeta;
  params?: readonly SweepResult[];
  norm?: readonly SweepResult[];
  weights?: readonly SweepResult[];
  penalty?: readonly SweepResult[];
  density?: readonly SweepResult[];
  robust?: readonly SweepResult[];
  learn?: {
    main: readonly LearningResult[];
    eta: readonly LearningResult[];
    raw: readonly LearningResult[];
    objective: readonly ObjectiveResult[];
  };
  text?: readonly TextResult[];
}

const WORLD_AGAINST = [
  { header: 'Δ so với Ngẫu nhiên', label: 'Ngẫu nhiên' },
  { header: 'Δ so với "Bỏ khả dụng"', label: 'Bỏ khả dụng' },
];

/** Bao cao 7b. Muc nao thieu ket qua thi bo (cho phep chay tung thi nghiem rieng roi gop lai). */
export function buildSweepReport(input: SweepReportInput): string {
  const { meta } = input;
  const n = meta.seeds.length;
  const out: string[] = [];
  out.push('# Đánh giá module gợi ý phân công — quét tham số, học trọng số, độ bền vững (bước 7b)');
  out.push('');
  out.push(
    `${meta.experimentRuns ? 'Ngày lập báo cáo' : 'Ngày chạy'} ${meta.date} · ${n} hạt giống (${meta.seeds[0]}–${meta.seeds[n - 1]}) · giai đoạn đánh giá từ ngày ${meta.minDay} · ` +
      `sha256 dữ liệu \`${meta.datasetSha256.slice(0, 16)}…\``
  );
  out.push(...provenanceLines(meta));
  if (n < 20) out.push('', `> **Cảnh báo**: chỉ ${n} hạt giống (< 20) — khoảng tin cậy kém tin cậy, chỉ dùng để chạy thử.`);
  out.push('');
  out.push(
    'Mọi phép so sánh cặp ("Δ … [95% CI]") là **cùng thẻ, cùng may rủi**, chỉ tính giữa các điểm trong CÙNG một thế giới; kết luận chỉ dựa vào ' +
      'việc khoảng tin cậy có chứa 0 hay không. Tham số giữ đúng mặc định đã duyệt: các bảng dưới đây **mô tả**, không dùng để chọn lại tham số.'
  );
  out.push('');
  if (input.params) {
    out.push('## 1. Quét tham số của bộ chấm (vòng kín, nhánh đầy đủ; mỗi lần đổi một tham số)', '');
    out.push(sweepSections(input.params));
  }
  if (input.norm) {
    out.push('## 2. Chuẩn hoá và người chưa có lịch sử (DROP hay NEUTRAL)', '');
    out.push(sweepGroupTable(input.norm), '');
    const deltas = newcomerDeltaLines(input.norm);
    if (deltas) out.push(deltas, '');
    out.push(
      '*Người mới* = việc người vào muộn nhận / phần chia đều kỳ vọng (1 = công bằng); *Người mới dẫn đầu* = tỉ lệ quyết định mà người xếp đầu chưa có thẻ nào đã xong. ' +
        'Trong vòng kín, người không được giao việc thì mãi không có lịch sử — nên cột này cho thấy hệ quả tích luỹ mà phát lại lịch sử cố định không thấy.',
      ''
    );
  }
  if (input.weights) {
    out.push('## 3. Lưới trọng số', '');
    out.push(weightsGridTable(input.weights), '');
  }
  if (input.penalty || input.density) {
    out.push('## 4. Thế giới: mức phạt tải và mật độ việc', '');
    out.push(
      'Khi việc ít, tải gần như không ảnh hưởng nên thành phần khả dụng không có gì để đóng góp; các bảng dưới đây tăng mức phạt tải của mô hình kết quả và mật độ việc để xem khả dụng có ích khi tải thật sự quan trọng không.',
      ''
    );
    if (input.penalty) out.push(sweepSections(input.penalty, { against: WORLD_AGAINST }, 3));
    if (input.density) out.push(sweepSections(input.density, { against: WORLD_AGAINST }, 3));
  }
  if (input.robust) {
    out.push('## 5. Độ bền vững trước các nguồn lệch của bộ sinh', '');
    out.push(robustnessTable(input.robust), '');
    out.push(
      'Mỗi dòng là một thế giới (một nguồn lệch được hạ thấp hoặc nâng cao so với mặc định); thứ hạng cho biết các nhánh có giữ thứ tự khi giả định của bộ sinh đổi hay không.',
      ''
    );
  }
  if (input.learn) {
    out.push('## 6. Học trọng số (mức 2)', '');
    out.push(
      'Trưởng nhóm giả có một **thiên lệch tuỳ ý** (ba trọng số) và chọn người có tiện ích cao nhất kèm nhiễu; nó không biết kỹ năng ẩn. Các bảng đo trọng số học được **bám theo gu đó** đến đâu và tỉ lệ người xếp đầu trùng lựa chọn của trưởng nhóm ' +
        '— **không** chứng minh việc học làm kết quả khách quan tốt hơn (xem 6.5).',
      ''
    );
    out.push('### 6.1 Đường hội tụ của trọng số học được (tốc độ học của sản phẩm)', '', learningTable(input.learn.main), '');
    out.push('### 6.2 Tỉ lệ chấp nhận: người xếp đầu có trùng lựa chọn của trưởng nhóm không', '', acceptanceTable(input.learn.main), '');
    out.push(
      '*Chỉ quyết định đủ dữ liệu* = các quyết định mà mọi ứng viên đều có đủ ba thành phần; đó là mẫu số chung của hai nhánh. Cột "mọi quyết định" bị chi phối bởi người mới: với `DROP`, người chưa có lịch sử chỉ còn thành phần khả dụng nên điểm được chia lại thành chính giá trị đó (điểm 100 nếu hoàn toàn rảnh) và thường đứng đầu; trưởng nhóm không chọn họ nên họ không bao giờ có lịch sử, khả dụng mãi cao và bị gợi ý mãi — bộ học cũng không sửa được vì luật "thiếu thành phần thì không học".',
      ''
    );
    out.push('### 6.3 Quét tốc độ học', '', etaTable(input.learn.eta), '');
    out.push(
      '### 6.4 Gu nằm ngoài không gian đặc trưng của bộ học (trưởng nhóm nhìn giá trị thô)',
      '',
      learningTable(input.learn.raw),
      '',
      acceptanceTable(input.learn.raw),
      ''
    );
    out.push('### 6.5 Ảnh hưởng khách quan của việc học (nhánh có học tự giao người xếp đầu)', '', objectiveTable(input.learn.objective), '');
  }
  if (input.text) {
    out.push('## 7. Chuỗi xử lý văn bản: bi-gram và trọng số tiêu đề', '');
    out.push(textTable(input.text), '');
    out.push(
      'Đo bằng "láng giềng gần nhất của một thẻ có cùng chủ đề ẩn không" (thẻ mơ hồ không làm truy vấn). Từ vựng mô phỏng chỉ có 8 chủ đề nên đây là **cận trên** trên một thị trường đồ chơi, chỉ chứng minh chuỗi xử lý không hỏng.',
      ''
    );
  }
  out.push('## Giới hạn (đọc trước khi trích dẫn)', '');
  out.push(
    '- Mọi số liệu nằm trong **thế giới giả định của tác giả**; các bảng độ bền vững và quét thế giới cho biết kết luận có nhạy với giả định hay không, nhưng không thay được dữ liệu thật.\n' +
      `- Khoảng tin cậy tính trên ${n} hạt giống (mỗi hạt giống là một đơn vị độc lập), không tính trên từng thẻ; các phép so sánh ngoài danh sách đã đăng ký trước chỉ mang tính mô tả và không hiệu chỉnh đa so sánh.\n` +
      '- Trưởng nhóm giả là **một mô hình gu tuỳ ý**; không có người dùng thật trong vòng lặp.'
  );
  return out.join('\n');
}
