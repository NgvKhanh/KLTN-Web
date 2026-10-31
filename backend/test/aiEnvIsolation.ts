// Test KHONG BAO GIO duoc goi LLM that: backend/.env cua may dev co the chua khoa Gemini that
// (buoc 9), ma test API (ai.api/ai.apply...) goi generatePlan voi env.ai mac dinh -> se ton han
// muc va cho ket qua khong on dinh.
//
// Module nay PHAI duoc import DAU TIEN trong test/setup.ts: cac `import` duoc nang len va chay
// theo thu tu, ma src/config/env.ts (qua prisma) doc process.env luc import. dotenv KHONG ghi de
// bien da co trong process.env (ke ca rong) va env.ts coi rong nhu chua dat, nen dat rong o day
// thi env.ai luon rong. Test can LLM thi tu truyen cfg / Object.assign(env.ai, ...) va fetch gia
// (xem ai.llm.test.ts). Chot canh giu: test/ai.isolation.test.ts.
for (const key of ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL']) process.env[key] = '';
