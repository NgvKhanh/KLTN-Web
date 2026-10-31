import { describe, expect, it } from 'vitest';
import { agent, makeUser } from './helpers';

// Van de #5: /login phai co gioi han so lan thu (loginLimiter = 20 / 15 phut,
// bo qua lan dang nhap dung)
describe('#5 gioi han so lan dang nhap sai', () => {
  it('sau nhieu lan sai lien tiep -> bi chan 429', async () => {
    const user = await makeUser();

    let blocked = false;
    for (let i = 0; i < 25; i += 1) {
      const res = await agent()
        .post('/api/auth/login')
        .send({ email: user.email, password: 'sai-mat-khau' });
      if (res.status === 429) {
        blocked = true;
        break;
      }
      expect(res.status).toBe(401); // truoc khi bi chan: sai mat khau
    }
    expect(blocked).toBe(true);
  });
});
