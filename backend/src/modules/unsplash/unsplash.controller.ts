import type { Request, Response } from 'express';
import { asyncHandler } from '../../utils/asyncHandler';
import type { ListPhotosQuery, TrackDownloadInput } from './unsplash.schema';
import { searchPhotos, trackDownload } from './unsplash.service';

export const listPhotosHandler = asyncHandler(
  async (_req: Request, res: Response) => {
    const params = res.locals.query as ListPhotosQuery;
    const result = await searchPhotos(params);
    res.json({ success: true, data: result });
  }
);

export const trackDownloadHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const { downloadLocation } = req.body as TrackDownloadInput;
    await trackDownload(downloadLocation);
    res.json({ success: true });
  }
);
