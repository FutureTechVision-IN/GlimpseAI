import { db, mediaJobsTable } from "@workspace/db";
import { lt, and, or, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Clears persisted base64 blobs from completed jobs older than MEDIA_RETENTION_HOURS (default 48).
 * Metadata rows remain for history/admin; reference_code is preserved.
 */
export async function purgeExpiredMediaBlobs(): Promise<number> {
  const hours = Number(process.env.MEDIA_RETENTION_HOURS ?? "48");
  if (hours <= 0) {
    return 0;
  }
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const result = await db
    .update(mediaJobsTable)
    .set({
      base64Data: null,
      processedUrl: null,
      thumbnailUrl: null,
      mediaPurgedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        lt(mediaJobsTable.createdAt, cutoff),
        or(isNotNull(mediaJobsTable.base64Data), isNotNull(mediaJobsTable.processedUrl)),
      ),
    )
    .returning({ id: mediaJobsTable.id });

  if (result.length > 0) {
    logger.info({ purged: result.length, cutoff: cutoff.toISOString() }, "Media blob retention purge");
  }
  return result.length;
}
