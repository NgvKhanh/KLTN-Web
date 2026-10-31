import { describe, expect, it } from 'vitest';
import { maskEmails } from '../src/utils/privacy';

describe('maskEmails', () => {
  it('che moi truong "email" o moi do sau (doi tuong, mang long nhau), giu nguyen phan con lai', () => {
    const when = new Date('2026-10-14T00:00:00.000Z');
    const input = {
      id: 'c1',
      createdAt: when,
      members: [{ userId: 'u1', user: { id: 'u1', name: 'A', email: 'a@x.vn' } }],
      comments: [{ text: 'hi', user: { name: 'B', email: 'b@x.vn' } }],
      nested: { deeper: [{ owner: { email: 'o@x.vn', note: null } }] },
    };
    const out = maskEmails(input);
    expect(out.members[0]!.user).toEqual({ id: 'u1', name: 'A', email: '' });
    expect(out.comments[0]!.user.email).toBe('');
    expect(out.nested.deeper[0]!.owner).toEqual({ email: '', note: null });
    expect(out.createdAt).toBe(when); // Date giu nguyen tham chieu
    expect(out.id).toBe('c1');
  });

  it('khong sua dau vao (tra ban sao moi)', () => {
    const input = { user: { email: 'a@x.vn' }, list: [{ email: 'b@x.vn' }] };
    const out = maskEmails(input);
    expect(input.user.email).toBe('a@x.vn');
    expect(input.list[0]!.email).toBe('b@x.vn');
    expect(out).not.toBe(input);
  });

  it('chi che chuoi: gia tri khac (null, so) o khoa "email" giu nguyen; kieu nguyen thuy tra lai nguyen', () => {
    expect(maskEmails({ email: null })).toEqual({ email: null });
    expect(maskEmails({ email: 5 })).toEqual({ email: 5 });
    expect(maskEmails('a@x.vn')).toBe('a@x.vn');
    expect(maskEmails(null)).toBeNull();
    expect(maskEmails([])).toEqual([]);
  });
});
