import { readFileSync, readdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vung bang + panel tro ly (CHATBOT_MODULE.md §13: tro ly ho tro che do toi).
const DIRS = ['src/components/board', 'src/components/assistant'].map((d) => join(process.cwd(), d));
const FILES = DIRS.flatMap((dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'))
    .map((f) => join(dir, f))
);

/**
 * Cat file nguon thanh cac "doan class lien tuc". Bat ky ky tu nao khong the
 * xuat hien trong danh sach class (dau nhay, ngoac, $, xuong dong...) deu la
 * ranh gioi - nho vay hai nhanh cua mot bieu thuc ba ngoi (`c ? 'a' : 'b'`)
 * duoc tach ra, khong bi coi la cung mot phan tu.
 */
function classRuns(src: string): string[] {
  return src.split(/["'`{}$()<>=,;\r\n]+/);
}

/** "dark:hover:bg-slate-700" -> khoa "hover|bg" de phat hien trung thuoc tinh */
function darkKey(token: string): string {
  const parts = token.slice('dark:'.length).split(':');
  const utility = parts.pop()!;
  return `${parts.join(':')}|${utility.split('-')[0]}`;
}

describe('Che do toi cua vung bang', () => {
  /**
   * Trong Tailwind, `bg-white` va `dark:bg-slate-800` co do uu tien BANG NHAU
   * (bien the dark dung :where() nen khong them do dac hieu). Neu mot doan
   * class co hai bien the dark: cung thuoc tinh thi cai nao thang la do thu tu
   * trong file CSS sinh ra - khong doan truoc duoc.
   */
  it('khong co doan class nao chua hai bien the dark: cung thuoc tinh', () => {
    const conflicts: string[] = [];
    for (const file of FILES) {
      for (const run of classRuns(readFileSync(file, 'utf8'))) {
        if (!run.includes('dark:')) continue;
        const byKey = new Map<string, string[]>();
        for (const token of run.split(/\s+/)) {
          if (!token.startsWith('dark:')) continue;
          const key = darkKey(token);
          byKey.set(key, [...(byKey.get(key) ?? []), token]);
        }
        for (const [, tokens] of byKey) {
          if (tokens.length > 1) {
            conflicts.push(`${basename(file)}: ${tokens.join(' vs ')}`);
          }
        }
      }
    }
    expect(conflicts).toEqual([]);
  });

  it('cac be mat sang cua bang deu co mau tuong ung cho nen toi', () => {
    const missing = FILES.filter((file) => {
      const src = readFileSync(file, 'utf8');
      const usesLightSurface = /\bbg-white\b(?!\/)|bg-\[#f1f2f4\]/.test(src);
      return usesLightSurface && !src.includes('dark:bg-slate-');
    }).map((file) => basename(file));
    expect(missing).toEqual([]);
  });

  it('panel tro ly: MOI doan class co nen sang (bg-white) deu tu mang mau nen toi (khong dua vao cho khac trong tep)', () => {
    const missing: string[] = [];
    for (const file of FILES.filter((f) => f.includes('assistant'))) {
      for (const run of classRuns(readFileSync(file, 'utf8'))) {
        if (/(^|\s)bg-white(\s|$)/.test(run) && !/(^|\s)dark:bg-/.test(run)) missing.push(`${basename(file)}: ${run.trim().slice(0, 60)}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('quet ca vung bang lan panel tro ly (chot chong "xanh gia" khi doi thu muc)', () => {
    const names = FILES.map((f) => basename(f));
    expect(names).toEqual(expect.arrayContaining(['CardModal.tsx', 'AssistantPanel.tsx', 'AnswerView.tsx', 'V2AnswerView.tsx', 'ActionCard.tsx', 'AssistantButton.tsx']));
  });
});
