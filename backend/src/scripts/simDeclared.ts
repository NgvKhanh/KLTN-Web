// Bo sinh HO SO TU KHAI cho bo mo phong (buoc 14, ASSIGN_MODULE.md §17.10). CHAY TAY / DANH GIA - khong nam trong san pham.
//
// Ho so viet LUC NGUOI DO VAO NHOM (ky nang an o ngay vao - nguoi hoc nghe ve sau se khai THIEU, nhu ngoai doi), rut tu LUONG NGAU
// NHIEN RIENG streamSeed(hat giong, vi tri nguoi, STREAM_SALTS.declared): generateSimulation KHONG doi -> ba ma bam dong bang cu
// giu nguyen. Moi chu de LUON rut dung so lan (khai hay khong) -> doi mot num (vd pOver) khong lam doi phan con lai cua ho so (so
// sanh cap giua cac muc cua num la "cung may rui").
//
// BO TU KHAI RIENG la bat buoc: neu ho so dung dung tu cua the thi thanh phan Ho so gan nhu "biet dap an". `overlap` = ti le cum
// lay tu tu vung CUA THE (khop duoc), phan con lai lay tu bo tu rieng (thuat ngu cong nghe tieng Anh - hau nhu khong co trong the
// nen vectorizeKnown bo di -> khong khop). Test canh: bo tu rieng khong trung thuat ngu nao cua bo sinh the.
//
// DOC ky nang an (skillAt) - CHI nam trong scripts/, module assign/ khong bao gio import tep nay.

import { declaredItems, type DeclaredItem, type DeclaredProfile, type DeclaredWorkItem } from '../modules/assign/assign.declared';
import { streamSeed } from './evalAssignStats';
import { STREAM_SALTS } from './evalAssignRun';
import { Rng, skillAt, type SimDataset } from './simGenerator';
import { TOPICS } from './simVocab';

export interface DeclaredSimConfig {
  /** Khai mot chu de neu ky nang an (luc vao nhom) >= theta. */
  theta: number;
  /** Xac suat khai them mot chu de minh YEU (khai qua). */
  pOver: number;
  /** Xac suat bo sot mot chu de minh MANH (khai thieu). */
  pUnder: number;
  /** Ti le cum khai lay tu tu vung CUA THE (con lai tu bo tu khai rieng). */
  overlap: number;
  /** Ti le nguoi KHONG khai ho so. */
  pNone: number;
  /** Mot nguoi CO TINH khai moi chu de (§17.10 "nguoi khai qua"); null = khong co. */
  liarKey: string | null;
}

/** Chot TRUOC khi do (§17.10). */
export const DEFAULT_DECLARED_SIM: Readonly<DeclaredSimConfig> = {
  theta: 0.5,
  pOver: 0.15,
  pUnder: 0.15,
  overlap: 0.5,
  pNone: 0.3,
  liarKey: null,
};

/**
 * Bo tu khai RIENG theo chu de (cung thu tu TOPICS): thuat ngu cong nghe ma bo sinh the khong bao gio dung. Tu nao trung tu cua the
 * (test kiem) se bi loai khoi day.
 */
export const DECLARED_VOCAB: readonly (readonly string[])[] = [
  ['ReactJS hooks', 'VueJS', 'TailwindCSS', 'Bootstrap grid', 'Sass mixin', 'Storybook', 'Redux toolkit', 'Webpack bundler'],
  ['NodeJS Express', 'NestJS', 'Spring Boot', 'GraphQL resolver', 'gRPC service', 'Postman collection', 'JWT refresh token', 'Swagger OpenAPI'],
  ['PostgreSQL', 'MongoDB', 'Redis cache', 'Prisma ORM', 'MySQL replication', 'Elasticsearch', 'sharding', 'stored procedure'],
  ['Jest', 'Cypress e2e', 'Selenium WebDriver', 'Playwright', 'JUnit', 'mocking stub', 'TDD', 'Vitest coverage'],
  ['Markdown', 'LaTeX Overleaf', 'Confluence wiki', 'Notion workspace', 'technical writing', 'PowerPoint deck', 'OneNote', 'Grammarly'],
  ['Axure RP', 'Adobe XD', 'Balsamiq mockup', 'persona mapping', 'design tokens', 'Sketch app', 'usability heuristic', 'Material Design'],
  ['Podman compose', 'Kubernetes', 'GitHub Actions', 'Nginx proxy', 'AWS EC2', 'Terraform', 'Linux bash', 'Jenkins pipeline'],
  ['BPMN', 'story mapping workshop', 'Jira backlog', 'UML usecase', 'stakeholder interview', 'SRS IEEE', 'MoSCoW', 'acceptance criteria'],
];

/** Dong "don" cua CV, khong lien quan chu de nao. */
export const CV_FILLER: readonly string[] = [
  'Học vấn: Đại học Bách khoa, ngành Công nghệ thông tin, tốt nghiệp loại khá',
  'Sở thích: bóng đá, đọc sách, du lịch bụi',
  'Địa chỉ: 12 Nguyễn Văn Bảo, phường 4, Gò Vấp',
  'Ngoại ngữ: TOEIC 750, giao tiếp cơ bản',
  'Hoạt động: tình nguyện mùa hè xanh, câu lạc bộ guitar',
];

const SKILLS_PER_TOPIC = 2;

function validate(cfg: DeclaredSimConfig): void {
  for (const k of ['theta', 'pOver', 'pUnder', 'overlap', 'pNone'] as const) {
    if (!Number.isFinite(cfg[k]) || cfg[k] < 0 || cfg[k] > 1) throw new RangeError(`${k} phai trong [0,1]`);
  }
}

export interface SimDeclared {
  /** null = nguoi do khong khai. */
  profile: DeclaredProfile | null;
  /** Chu de da khai (AN - chi de phan tich, khong dua vao bo cham). */
  topics: number[];
}

/** Ho so tu khai cua moi nguoi trong bo du lieu (theo khoa nguoi). Tat dinh theo (hat giong, cfg). */
export function generateDeclaredProfiles(data: SimDataset, over: Partial<DeclaredSimConfig> = {}): Map<string, SimDeclared> {
  const cfg: DeclaredSimConfig = { ...DEFAULT_DECLARED_SIM, ...over };
  validate(cfg);
  if (cfg.liarKey !== null && !data.people.some((p) => p.key === cfg.liarKey)) {
    throw new RangeError(`liarKey khong co trong bo du lieu: ${cfg.liarKey}`);
  }
  const out = new Map<string, SimDeclared>();
  data.people.forEach((person, index) => {
    const rng = new Rng(streamSeed(data.config.seed, index, STREAM_SALTS.declared));
    const liar = person.key === cfg.liarKey;
    const silent = rng.next() < cfg.pNone && !liar;
    const skills: string[] = [];
    const work: DeclaredWorkItem[] = [];
    const topics: number[] = [];
    TOPICS.forEach((topic, t) => {
      // So lan rut CO DINH moi chu de (khai hay khong): 1 quyet dinh + 2 cum x 2 + so cong viec + 2 cong viec x 4
      const decide = rng.next();
      const phrases = Array.from({ length: SKILLS_PER_TOPIC }, () => ({ fromCard: rng.next() < cfg.overlap, pick: rng.next() }));
      const jobs = 1 + rng.int(2);
      const works = Array.from({ length: 2 }, () => ({ fromCard: rng.next() < cfg.overlap, a: rng.next(), b: rng.next(), c: rng.next() }));
      const strong = skillAt(person, t, person.joinedDay) >= cfg.theta;
      const declares = liar || (strong ? decide >= cfg.pUnder : decide < cfg.pOver);
      if (!declares) return;
      topics.push(t);
      const own = DECLARED_VOCAB[t]!;
      const pickOf = <T>(xs: readonly T[], u: number): T => xs[Math.min(xs.length - 1, Math.floor(u * xs.length))]!;
      for (const ph of phrases) skills.push(ph.fromCard ? pickOf(topic.objects, ph.pick) : pickOf(own, ph.pick));
      for (const w of works.slice(0, jobs)) {
        work.push(
          w.fromCard
            ? { title: `${pickOf(topic.verbs, w.a)} ${pickOf(topic.objects, w.b)}`, description: `${pickOf(topic.descWords, w.c)}, ${pickOf(topic.descWords, 1 - w.c)}` }
            : { title: `Dự án cá nhân ${pickOf(own, w.a)}`, description: `${pickOf(own, w.b)}, ${pickOf(own, w.c)}` }
        );
      }
    });
    if (silent || topics.length === 0) {
      out.set(person.key, { profile: null, topics: [] });
      return;
    }
    const filler = CV_FILLER.filter(() => rng.next() < 0.6);
    const cvText = [
      `Kỹ năng:\n${skills.map((s) => `- ${s}`).join('\n')}`,
      `Kinh nghiệm:\n${work.map((w) => `- ${w.title}: ${w.description}`).join('\n')}`,
      ...filler,
    ].join('\n\n');
    out.set(person.key, { profile: { skillsText: skills.join(', '), workItems: work, cvText }, topics });
  });
  return out;
}

/** Cat san muc khai MOT lan cho moi nguoi (dua vao RunOptions.declared / snapshotAsOf). */
export function declaredItemsByPerson(profiles: ReadonlyMap<string, SimDeclared>): Map<string, DeclaredItem[]> {
  return new Map([...profiles].map(([key, p]) => [key, declaredItems(p.profile)]));
}
