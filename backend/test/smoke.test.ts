import { describe, expect, it } from 'vitest';
import { agent, makeBoard, makeUser } from './helpers';

describe('ha tang test', () => {
  it('health tra ve 200', async () => {
    const res = await agent().get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('dang ky + tao bang chay duoc', async () => {
    const user = await makeUser();
    const board = await makeBoard(user);
    expect(board.id).toBeTruthy();
    expect(board.ownerId).toBe(user.id);
  });
});
