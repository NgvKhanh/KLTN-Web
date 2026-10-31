import { describe, expect, it } from 'vitest';
import { env } from '../src/config/env';
import { isLlmAvailable } from '../src/modules/ai/ai.service';

// Chot an toan cho buoc 9: sau khi backend/.env co khoa Gemini that, test van phai chay
// duong bo luat (khong ra mang, khong ton han muc). test/setup.ts dat 3 bien AI_* rong.
describe('moi truong test khong co khoa AI', () => {
  it('env.ai rong ba bien bat buoc -> LLM khong san sang', () => {
    expect(env.ai.baseUrl).toBe('');
    expect(env.ai.apiKey).toBe('');
    expect(env.ai.model).toBe('');
    expect(isLlmAvailable(env.ai)).toBe(false);
  });

  it('process.env cung rong (module khac doc thang cung khong thay khoa)', () => {
    expect(process.env.AI_API_KEY ?? '').toBe('');
    expect(process.env.AI_BASE_URL ?? '').toBe('');
    expect(process.env.AI_MODEL ?? '').toBe('');
  });
});
