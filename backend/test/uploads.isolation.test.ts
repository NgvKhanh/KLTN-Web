// Chot canh giu cho test/uploadsIsolation.ts: neu test nao do lam thu muc tai len quay ve backend/uploads THAT (bo import trong
// setup.ts, doi ten bien...), tep nay do truoc khi mot test kip ghi / xoa tep cua nguoi dung.
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AVATAR_DIR, BOARD_BG_DIR, CV_DIR, UPLOAD_ROOT, cardAttachmentDiskPath } from '../src/config/upload';
import { TEST_UPLOAD_ROOT } from './uploadsIsolation';

const REAL = path.resolve(__dirname, '..', 'uploads');
const inside = (dir: string, root: string) => {
  const rel = path.relative(root, dir);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

describe('test khong dung vao thu muc tai len that', () => {
  it('UPLOAD_ROOT = thu muc tam cua test, nam trong thu muc tam cua he dieu hanh, KHONG nam trong backend/uploads', () => {
    expect(UPLOAD_ROOT).toBe(TEST_UPLOAD_ROOT);
    expect(inside(UPLOAD_ROOT, os.tmpdir())).toBe(true);
    expect(inside(UPLOAD_ROOT, REAL)).toBe(false);
  });

  it('moi thu muc con (anh nen, anh dai dien, tep dinh kem, CV) deu nam trong thu muc tam', () => {
    for (const dir of [BOARD_BG_DIR, AVATAR_DIR, path.dirname(cardAttachmentDiskPath('x')), CV_DIR]) {
      expect(inside(dir, TEST_UPLOAD_ROOT), dir).toBe(true);
      expect(inside(dir, REAL), dir).toBe(false);
    }
  });
});
