import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Hop dong cua he chuyen dong: nguoi dung chon "giam chuyen dong" thi KHONG duoc con
// hieu ung trang tri nao. Test doc thang motion.css, lay moi selector co "animation:"
// o ngoai khoi @media (prefers-reduced-motion: reduce) va yeu cau no nam trong khoi do.
const css = readFileSync(resolve(__dirname, 'motion.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function reducedMotionBlock(source: string): string {
  const start = source.indexOf('@media (prefers-reduced-motion: reduce)');
  if (start === -1) return '';
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  return '';
}

function animatedSelectors(source: string): string[] {
  const out: string[] = [];
  const rule = /([^{}@][^{}]*)\{([^{}]*)\}/g;
  for (const m of source.matchAll(rule)) {
    if (/(^|[\s;])animation\s*:/.test(m[2]) && !/animation\s*:\s*none/.test(m[2])) {
      for (const sel of m[1].split(',')) out.push(sel.trim().replace(/\s+/g, ' '));
    }
  }
  return out;
}

describe('motion.css', () => {
  const reduced = reducedMotionBlock(css);
  const selectors = animatedSelectors(css.replace(reduced, ''));

  it('có khối tắt hiệu ứng khi người dùng chọn giảm chuyển động', () => {
    expect(reduced).not.toBe('');
  });

  it('có ít nhất một lớp hiệu ứng (để test bên dưới thực sự kiểm tra gì đó)', () => {
    expect(selectors.length).toBeGreaterThan(0);
  });

  it('mọi lớp có animation đều bị tắt trong khối giảm chuyển động', () => {
    const inBlock = reduced.replace(/\s+/g, ' ');
    const missing = selectors.filter((sel) => !inBlock.includes(sel));
    expect(missing).toEqual([]);
  });
});
