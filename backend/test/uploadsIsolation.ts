// Test KHONG BAO GIO duoc ghi / xoa vao backend/uploads THAT: thu muc do bind-mount chung voi backend trong Docker, chua anh dai
// dien, anh nen, tep dinh kem, CV that cua nguoi dung. Ngay 04/10 mot test CV da xoa CV that (danh sach "tep co san" khoi tao rong
// nen don ca tep cua nguoi dung) - khong khoi phuc duoc.
//
// Module nay PHAI duoc import DAU TIEN trong test/setup.ts (cung ly do voi aiEnvIsolation.ts): src/config/upload.ts doc
// UPLOAD_ROOT luc import. Chot canh giu: test/uploads.isolation.test.ts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const TEST_UPLOAD_ROOT = path.join(os.tmpdir(), 'taskflow-test-uploads');
fs.mkdirSync(TEST_UPLOAD_ROOT, { recursive: true });
process.env.UPLOAD_ROOT = TEST_UPLOAD_ROOT;
