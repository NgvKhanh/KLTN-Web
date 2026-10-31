import dotenv from 'dotenv';
import { parseTrustProxy } from './trustProxy';

// Doc file .env va nap vao process.env
dotenv.config();

/**
 * Lay 1 bien moi truong dang chuoi.
 * - Neu khong co va cung khong co gia tri mac dinh -> nem loi ngay khi khoi dong.
 */
function getString(key: string, defaultValue?: string): string {
  const value = process.env[key];

  if (value === undefined || value.trim() === '') {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw new Error(
      `Thieu bien moi truong bat buoc: ${key}. Hay tao file .env tu .env.example.`
    );
  }

  return value.trim();
}

/**
 * Lay 1 bien moi truong dang so nguyen duong (dung cho PORT).
 */
function getPort(key: string, defaultValue: number): number {
  const raw = process.env[key];

  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(
      `Bien moi truong ${key} phai la so nguyen tu 1 den 65535, dang nhan duoc: "${raw}"`
    );
  }

  return parsed;
}

/**
 * Lay 1 bien moi truong dang so nguyen duong bat ky (khong gioi han tren 65535
 * nhu getPort). Dung cho timeout (ms), gioi han ky tu...
 */
function getPositiveInt(key: string, defaultValue: number): number {
  const raw = process.env[key];

  if (raw === undefined || raw.trim() === '') {
    return defaultValue;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `Bien moi truong ${key} phai la so nguyen duong, dang nhan duoc: "${raw}"`
    );
  }

  return parsed;
}

/**
 * Lay 1 bien moi truong dang bat / tat: true/false, 1/0, on/off, yes/no (khong phan biet hoa thuong).
 * Gia tri la khac -> nem loi ngay khi khoi dong (tranh bat nham mot tinh nang co the GHI du lieu).
 */
function getBoolean(key: string, defaultValue: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return defaultValue;
  const value = raw.trim().toLowerCase();
  if (['true', '1', 'on', 'yes'].includes(value)) return true;
  if (['false', '0', 'off', 'no'].includes(value)) return false;
  throw new Error(`Bien moi truong ${key} phai la true/false (hoac 1/0, on/off), dang nhan duoc: "${raw}"`);
}

const nodeEnv = getString('NODE_ENV', 'development');
const chatEngine = getString('CHAT_ENGINE', nodeEnv === 'production' ? 'legacy' : 'v2');
if (!['legacy', 'v2'].includes(chatEngine)) throw new Error('CHAT_ENGINE phải là legacy hoặc v2');
const allowedNodeEnv = ['development', 'production', 'test'];

if (!allowedNodeEnv.includes(nodeEnv)) {
  throw new Error(
    `NODE_ENV phai la mot trong: ${allowedNodeEnv.join(', ')}. Dang nhan duoc: "${nodeEnv}"`
  );
}

export const env = {
  chatEngine: chatEngine as 'legacy' | 'v2',
  /**
   * Chatbot v2 duoc phep THUC HIEN thao tac (tao the, doi ten, chuyen cot...)? Tat -> chi doc nhu truoc.
   * Mac dinh BAT o development/test, TAT o production (bat khi da nghiem thu).
   */
  chatActions: getBoolean('CHAT_ACTIONS', nodeEnv !== 'production'),
  /**
   * Thao tac du an toan co duoc TU CHAY khong can bam "Ap dung"? Tat -> moi thao tac deu hien xem truoc va doi xac nhan.
   */
  chatAutoExecute: getBoolean('CHAT_AUTO_EXECUTE', nodeEnv !== 'production'),
  nodeEnv,
  isProduction: nodeEnv === 'production',
  port: getPort('PORT', 4000),
  /**
   * Tin bao nhieu cap reverse proxy khi tinh req.ip (gioi han theo IP). null = khong tin (mac dinh).
   * Xem config/trustProxy.ts. BAT BUOC dat khi chay sau nginx / Cloudflare...
   */
  trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  /** Danh sach domain frontend duoc phep goi API */
  corsOrigins: getString('CORS_ORIGIN', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
  /** Chuoi ket noi PostgreSQL, bat buoc phai co */
  databaseUrl: getString('DATABASE_URL'),
  /** Khoa bi mat de ky JWT, bat buoc phai co va nen du dai/kho doan */
  jwtSecret: getString('JWT_SECRET'),
  /** Thoi gian song cua JWT, vi du "7d", "1h" */
  jwtExpiresIn: getString('JWT_EXPIRES_IN', '7d'),
  /**
   * Access Key cua Unsplash (https://unsplash.com/oauth/applications).
   * Dung cho thu vien anh nen bang. Khong bat buoc: neu de trong thi
   * API /api/unsplash tra ve 503 va frontend chi hien mau/gradient.
   */
  unsplashAccessKey: getString('UNSPLASH_ACCESS_KEY', ''),
  /**
   * Cau hinh gui email (quen mat khau, xac minh email).
   * Neu SMTP_HOST de trong -> backend tu dung Ethereal (mail ao, co link xem truoc).
   */
  mail: {
    host: getString('SMTP_HOST', ''),
    port: getPort('SMTP_PORT', 587),
    user: getString('SMTP_USER', ''),
    pass: getString('SMTP_PASS', ''),
    from: getString('MAIL_FROM', 'TaskFlow <no-reply@taskflow.local>'),
  },
  /** URL frontend, dung de tao link trong noi dung email. */
  frontendUrl: getString('FRONTEND_URL', 'http://localhost:5173'),
  /**
   * OAuth Client ID cua Google cho "Dang nhap bang Google".
   * Lay tu Google Cloud Console. De trong -> endpoint /auth/google tra ve 503.
   */
  googleClientId: getString('GOOGLE_CLIENT_ID', ''),
  /**
   * Module AI (xem AI_MODULE.md). Goi LLM qua chuan OpenAI-compatible
   * (POST {baseUrl}/chat/completions) nen doi nha cung cap (Gemini, Groq,
   * OpenRouter...) chi can doi baseUrl + model + apiKey trong .env.
   * KHAC voi Unsplash/Google o tren: thieu cau hinh KHONG tra 503 - module van
   * chay bang bo luat (rule-only), chi la khong co lop LLM. LLM chi duoc goi khi
   * DU CA BA: baseUrl, apiKey, model.
   */
  ai: {
    baseUrl: getString('AI_BASE_URL', '').replace(/\/+$/, ''),
    apiKey: getString('AI_API_KEY', ''),
    model: getString('AI_MODEL', ''),
    /** Nhan hien thi/ghi vao AiRun.provider, vd "google-gemini". */
    providerLabel: getString('AI_PROVIDER_LABEL', 'openai-compatible'),
    timeoutMs: getPositiveInt('AI_TIMEOUT_MS', 30000),
    /** Van ban dau vao dai hon muc nay se bi cat (kem canh bao). */
    maxInputChars: getPositiveInt('AI_MAX_INPUT_CHARS', 20000),
  },
};
