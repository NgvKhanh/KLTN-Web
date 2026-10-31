import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { env } from './env';

/**
 * Prisma Client dung chung cho toan bo backend.
 * Chi tao 1 instance duy nhat (singleton) de tranh mo qua nhieu ket noi toi DB.
 */
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

export const prisma = new PrismaClient({ adapter });
