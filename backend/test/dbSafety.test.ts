import { describe, expect, it } from 'vitest';
import {
  assertSafeTestDatabaseUrl,
  loadAndAssertTestDatabaseUrl,
} from './dbSafety';

// Van de moi #4: bo test co the tu xoa nham database neu DATABASE_URL
// khong ro rang la mot DB test cuc bo.
describe('#4 chan DATABASE_URL khong an toan truoc khi TRUNCATE/DROP', () => {
  it('tu choi database KHONG chua tu "test" (vd tro nham DB that)', () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        'postgresql://taskflow:taskflow@localhost:5432/taskflow'
      )
    ).toThrow(/khong an toan/i);
  });

  it('tu choi host khong phai localhost (vd server o xa)', () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        'postgresql://taskflow:taskflow@db.example.com:5432/taskflow_test'
      )
    ).toThrow(/khong an toan/i);
  });

  it('chap nhan database co ten chua "test" tren localhost', () => {
    const { dbName } = assertSafeTestDatabaseUrl(
      'postgresql://taskflow:taskflow@localhost:5432/taskflow_test?schema=public'
    );
    expect(dbName).toBe('taskflow_test');
  });

  it('chap nhan 127.0.0.1', () => {
    expect(() =>
      assertSafeTestDatabaseUrl(
        'postgresql://taskflow:taskflow@127.0.0.1:5432/app_test_db'
      )
    ).not.toThrow();
  });

  it('.env.test that cua project qua duoc kiem tra (khong throw khi chay test)', () => {
    expect(() => loadAndAssertTestDatabaseUrl()).not.toThrow();
  });
});
