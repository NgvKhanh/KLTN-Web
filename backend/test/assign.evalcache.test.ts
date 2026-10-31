import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssignEvaluationCache, sourceFingerprint, type CacheContext, type CacheEntry } from '../src/scripts/evalAssignCache';

const dirs: string[] = [];
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'assign-eval-cache-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const context = (): CacheContext => ({
  sourceSha256: 'source-v1', datasetSha256: 'dataset-v1', datasetSha256PerSeed: ['seed-a', 'seed-b'],
  seeds: [2001, 2002], minDay: 60, loadPenalty: 0.06, nodeVersion: process.version,
});

describe('cache danh gia phan cong', () => {
  it('tai su dung ket qua va giu nguyen thoi diem chay; refresh buoc tinh lai', () => {
    const dir = tempDir();
    const cache = new AssignEvaluationCache(dir, context());
    const compute = vi.fn(() => ({ score: 42 }));
    const first = cache.run('arms', compute);
    const later = new AssignEvaluationCache(dir, context());
    expect(later.run('arms', compute)).toEqual(first);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(later.run('arms', () => ({ score: 99 }), true).data).toEqual({ score: 99 });
    expect(later.load('arms')?.data).toEqual({ score: 99 });
    expect(fs.readdirSync(dir).filter((file) => file.endsWith('.tmp'))).toEqual([]);
  });

  it.each([
    ['ma nguon', { sourceSha256: 'source-v2' }],
    ['du lieu', { datasetSha256: 'dataset-v2' }],
    ['du lieu tung seed', { datasetSha256PerSeed: ['seed-a', 'changed'] }],
    ['danh sach seed cung so luong', { seeds: [9001, 9002] }],
    ['thu tu seed', { seeds: [2002, 2001] }],
    ['ngay bat dau', { minDay: 90 }],
    ['he so phat tai', { loadPenalty: 0.12 }],
    ['Node', { nodeVersion: 'v99.0.0' }],
  ])('khong tai su dung khi doi %s', (_name, change) => {
    const dir = tempDir();
    const old = new AssignEvaluationCache(dir, context());
    old.run('learn', () => 'old');
    const next = new AssignEvaluationCache(dir, { ...context(), ...change });
    expect(next.load('learn')).toBeUndefined();
    expect(next.run('learn', () => 'new').data).toBe('new');
    expect(old.load('learn')?.data).toBe('old'); // Hai phien ban khong ghi de cache cua nhau.
  });

  it('bo cache legacy chi co ten va so seed, ke ca trong che do chi doc', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'arms.2.json'), JSON.stringify({ score: 42 }));
    const cache = new AssignEvaluationCache(dir, context());
    expect(cache.load('arms')).toBeUndefined();
    expect(cache.run('arms', () => ({ score: 99 })).data).toEqual({ score: 99 });
  });

  it.each(['json', 'version', 'identity', 'key', 'data', 'time', 'experiment'])('bo cache hong/sai %s va tinh lai', (kind) => {
    const cache = new AssignEvaluationCache(tempDir(), context());
    const entry = cache.run('arms', () => ({ score: 42 }));
    if (kind === 'version') entry.version++;
    if (kind === 'identity') entry.identity.sourceSha256 = 'wrong';
    if (kind === 'key') entry.key = 'wrong';
    if (kind === 'data') entry.data.score = 0;
    if (kind === 'time') entry.completedAt = 'not-a-date';
    if (kind === 'experiment') entry.identity.experiment = 'learn';
    fs.writeFileSync(cache.file('arms'), kind === 'json' ? '{' : JSON.stringify(entry));
    expect(cache.load('arms')).toBeUndefined();
    expect(cache.run('arms', () => ({ score: 99 })).data).toEqual({ score: 99 });
  });

  it('khong ghi ket qua khi tinh toan that bai', () => {
    const dir = tempDir();
    const cache = new AssignEvaluationCache(dir, context());
    expect(() => cache.run('arms', () => { throw new Error('failed'); })).toThrow('failed');
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('ma bam ma nguon va cau hinh', () => {
  const fixture = () => {
    const dir = tempDir();
    const entry = path.join(dir, 'entry.ts');
    const lock = path.join(dir, 'package-lock.json');
    fs.writeFileSync(entry, "import { x } from './branch'; export const value = x;");
    fs.writeFileSync(path.join(dir, 'branch.ts'), "import { weight } from './score'; export const x = weight;");
    fs.writeFileSync(path.join(dir, 'score.ts'), "import './branch'; export const weight = 1;"); // Co chu trinh import.
    fs.writeFileSync(lock, '{"version":1}');
    return { dir, entry, lock };
  };

  it.each(['entry.ts', 'branch.ts', 'score.ts', 'package-lock.json'])('doi %s lam het han cache', (file) => {
    const { dir, entry, lock } = fixture();
    const first = sourceFingerprint(entry, [lock]);
    expect(sourceFingerprint(entry, [lock])).toBe(first);
    fs.appendFileSync(path.join(dir, file), '\n ');
    expect(sourceFingerprint(entry, [lock])).not.toBe(first);
  });

  it('bo qua tep ngoai cay import; thieu dependency thi dung, khong dung ma bam thieu', () => {
    const { dir, entry, lock } = fixture();
    const first = sourceFingerprint(entry, [lock]);
    fs.writeFileSync(path.join(dir, 'unrelated.ts'), 'export const x = 2;');
    expect(sourceFingerprint(entry, [lock])).toBe(first);
    fs.unlinkSync(path.join(dir, 'score.ts'));
    expect(() => sourceFingerprint(entry, [lock])).toThrow(/dependency/);
  });
});

describe('CLI cache va bao cao', () => {
  it('chay that, doc cache, giu moc chay cu khi dung lai bao cao va tu choi cache sai', () => {
    const dir = tempDir();
    const backendDir = path.resolve(__dirname, '..');
    const cacheDir = path.join(dir, 'cache');
    const report = path.join(dir, 'report.md');
    const cli = (exp: string, out = report) => spawnSync(process.execPath, [
      '--import', 'tsx', path.join(backendDir, 'src/scripts/evaluateAssign.ts'),
      `--exp=${exp}`, '--seeds=2', `--cache-dir=${cacheDir}`, `--out-sweeps=${out}`,
    ], { cwd: backendDir, encoding: 'utf8', timeout: 25_000 });
    const fresh = cli('text');
    expect(fresh.status, fresh.stderr).toBe(0);
    const file = path.join(cacheDir, fs.readdirSync(cacheDir).find((name) => name.startsWith('text.2.'))!);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry<unknown>;
    expect(entry.identity.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(entry.identity.datasetSha256PerSeed).toHaveLength(2);
    const cached = cli('text');
    expect(cached.status, cached.stderr).toBe(0);
    expect(cached.stderr).toContain('dung ket qua da nho');
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual(entry);

    entry.completedAt = '2025-01-02T03:04:05.000Z';
    fs.writeFileSync(file, JSON.stringify(entry));
    const rebuilt = cli('report');
    expect(rebuilt.status, rebuilt.stderr).toBe(0);
    const markdown = fs.readFileSync(report, 'utf8');
    expect(markdown).toContain('Ngày lập báo cáo');
    expect(markdown).toContain(entry.completedAt);
    const json = JSON.parse(fs.readFileSync(`${report}.json`, 'utf8'));
    expect(json.meta.experimentRuns).toEqual({ text: entry.completedAt });
    expect(json.meta.sourceSha256).toBe(entry.identity.sourceSha256);
    expect(json.meta.datasetSha256).toBe(entry.identity.datasetSha256);

    entry.identity.sourceSha256 = 'changed-algorithm';
    fs.writeFileSync(file, JSON.stringify(entry));
    const missing = path.join(dir, 'missing.md');
    const rejected = cli('report', missing);
    expect(rejected.status).toBe(1);
    expect(rejected.stderr).toContain('cache hop le');
    expect(fs.existsSync(missing)).toBe(false);
    expect(fs.readFileSync(report, 'utf8')).toBe(markdown);
    const rerun = cli('text');
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(rerun.stderr).toContain('bo cache khong hop le');
    expect(JSON.parse(fs.readFileSync(file, 'utf8')).identity.sourceSha256).toBe(json.meta.sourceSha256);
  }, 60_000);
});
