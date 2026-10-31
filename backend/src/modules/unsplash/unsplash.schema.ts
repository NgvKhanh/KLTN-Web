import { z } from 'zod';

// Tham so cho GET /api/unsplash (tim anh nen)
export const listPhotosQuerySchema = z.object({
  // Tu khoa tim kiem. De trong -> lay bo anh "noi bat" mac dinh.
  query: z.string().trim().max(100).optional(),
  // Trang ket qua (moi trang 30 anh)
  page: z.coerce.number().int().min(1).max(50).default(1),
});

// Body cho POST /api/unsplash/track-download
export const trackDownloadSchema = z.object({
  // Chinh la links.download_location cua anh Unsplash da chon
  downloadLocation: z
    .string()
    .trim()
    .regex(/^https:\/\/api\.unsplash\.com\//, 'Duong dan tai xuong khong hop le')
    .max(2048),
});

export type ListPhotosQuery = z.infer<typeof listPhotosQuerySchema>;
export type TrackDownloadInput = z.infer<typeof trackDownloadSchema>;
