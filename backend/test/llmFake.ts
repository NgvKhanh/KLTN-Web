// fetch gia cho test lop LLM (cung kieu ai.llm.test.ts). KHONG BAO GIO ra mang that: moi URL
// khong phai https://llm.test/.../chat/completions deu nem loi.
import { vi } from 'vitest';

export interface FakeCall {
  url: string;
  init: RequestInit;
  body: any;
}
export type FakeHandler = (call: FakeCall, n: number) => Response | Promise<Response>;

export function stubFetch(handler: FakeHandler): FakeCall[] {
  const calls: FakeCall[] = [];
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (!String(url).startsWith('https://llm.test/') || !String(url).endsWith('/chat/completions')) {
      throw new Error(`URL ngoai du kien: ${url}`);
    }
    const call: FakeCall = { url: String(url), init, body: JSON.parse(String(init.body)) };
    calls.push(call);
    return handler(call, calls.length);
  });
  return calls;
}

/** fetch bi goi la loi test (dung khi LLM phai KHONG duoc goi). */
export function forbidFetch(): FakeCall[] {
  return stubFetch(() => {
    throw new Error('khong duoc goi fetch');
  });
}

export const json = (status: number, body: unknown) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });

export const completion = (content: unknown, usage?: unknown) =>
  json(200, { choices: [{ message: { content: typeof content === 'string' ? content : JSON.stringify(content) } }], ...(usage ? { usage } : {}) });

/** Treo den khi bi huy (nha cung cap khong tra loi). */
export const hang = (call: FakeCall) =>
  new Promise<Response>((_res, rej) => {
    call.init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });

/** Ten luoc do json_schema cua mot request (null neu request khong o muc json_schema). */
export const schemaName = (call: FakeCall): string | null => call.body.response_format?.json_schema?.name ?? null;
