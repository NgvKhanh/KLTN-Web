// Cache danh gia offline: chi tai su dung ket qua co cung ma nguon, du lieu va cau hinh.
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const CACHE_VERSION = 1;
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Bam ca cay import cuc bo, ke ca dependency cua bo cham / bo sinh, va cac tep cau hinh. */
export function sourceFingerprint(entryFile: string, configFiles: readonly string[] = []): string {
  const root = path.dirname(path.resolve(entryFile));
  const files = new Map<string, string>();
  const visit = (file: string): void => {
    file = path.resolve(file);
    if (files.has(file)) return;
    const source = fs.readFileSync(file, 'utf8');
    files.set(file, source);
    if (path.extname(file) === '.json') return;
    for (const ref of ts.preProcessFile(source, true, true).importedFiles) {
      if (!ref.fileName.startsWith('.')) continue; // Goi ben ngoai duoc canh bang package-lock.json.
      const base = path.resolve(path.dirname(file), ref.fileName);
      const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.json`, path.join(base, 'index.ts'), path.join(base, 'index.js')];
      const resolved = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (!resolved) throw new Error(`Khong tim thay dependency de bam cache: ${ref.fileName} (${file})`);
      visit(resolved);
    }
  };
  visit(entryFile);
  for (const file of configFiles) visit(file);
  const entries = [...files].map(([file, source]) => [path.relative(root, file).replace(/\\/g, '/'), source]);
  entries.sort(([a], [b]) => a!.localeCompare(b!, 'en'));
  return sha256(JSON.stringify(entries));
}

export interface CacheContext {
  sourceSha256: string;
  datasetSha256: string;
  datasetSha256PerSeed: readonly string[];
  seeds: readonly number[];
  minDay: number;
  loadPenalty: number;
  nodeVersion: string;
}

export interface CacheEntry<T> {
  version: number;
  identity: CacheContext & { experiment: string };
  key: string;
  completedAt: string;
  dataSha256: string;
  data: T;
}

export class AssignEvaluationCache {
  constructor(
    private readonly dir: string,
    private readonly context: CacheContext,
    private readonly log: (line: string) => void = () => {},
  ) {}

  private identity(name: string): CacheEntry<unknown>['identity'] {
    // Thu tu khoa co dinh: khong phu thuoc thu tu tao object cua caller.
    return {
      experiment: name,
      sourceSha256: this.context.sourceSha256,
      datasetSha256: this.context.datasetSha256,
      datasetSha256PerSeed: this.context.datasetSha256PerSeed,
      seeds: this.context.seeds,
      minDay: this.context.minDay,
      loadPenalty: this.context.loadPenalty,
      nodeVersion: this.context.nodeVersion,
    };
  }

  private key(name: string): string {
    return sha256(JSON.stringify([CACHE_VERSION, this.identity(name)]));
  }

  file(name: string): string {
    return path.join(this.dir, `${name}.${this.context.seeds.length}.${this.key(name)}.json`);
  }

  load<T>(name: string): CacheEntry<T> | undefined {
    const file = this.file(name);
    if (!fs.existsSync(file)) {
      if (fs.existsSync(path.join(this.dir, `${name}.${this.context.seeds.length}.json`))) {
        this.log(`[${name}] bo cache cu khong co thong tin ma nguon/du lieu/cau hinh`);
      }
      return undefined;
    }
    try {
      const entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CacheEntry<T> | null;
      if (!entry || entry.version !== CACHE_VERSION || entry.key !== this.key(name) ||
          JSON.stringify(entry.identity) !== JSON.stringify(this.identity(name)) ||
          typeof entry.completedAt !== 'string' || new Date(entry.completedAt).toISOString() !== entry.completedAt ||
          entry.data === undefined || entry.dataSha256 !== sha256(JSON.stringify(entry.data))) {
        throw new Error('thong tin cache khong khop hoac du lieu hong');
      }
      this.log(`[${name}] dung ket qua da nho, chay xong ${entry.completedAt} (${file})`);
      return entry;
    } catch (error) {
      this.log(`[${name}] bo cache khong hop le: ${error instanceof Error ? error.message : String(error)} (${file})`);
      return undefined;
    }
  }

  run<T>(name: string, compute: () => T, refresh = false): CacheEntry<T> {
    const saved = refresh ? undefined : this.load<T>(name);
    if (saved) return saved;
    const t0 = Date.now();
    const data = compute();
    const entry: CacheEntry<T> = {
      version: CACHE_VERSION,
      identity: this.identity(name),
      key: this.key(name),
      completedAt: new Date().toISOString(),
      dataSha256: sha256(JSON.stringify(data)),
      data,
    };
    fs.mkdirSync(this.dir, { recursive: true });
    const file = this.file(name);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temp, JSON.stringify(entry), 'utf8');
      fs.renameSync(temp, file); // Reader khong bao gio doc mot JSON dang ghi do.
    } finally {
      if (fs.existsSync(temp)) fs.unlinkSync(temp);
    }
    this.log(`[${name}] xong sau ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${file}`);
    return entry;
  }
}
