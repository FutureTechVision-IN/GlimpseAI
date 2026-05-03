import app from "./app";
import { logger } from "./lib/logger";
import { assertProductionSecrets } from "./lib/env-validation";
import { purgeExpiredMediaBlobs } from "./lib/media-retention";
import { ensureInitialAdmin, ensureDefaultPlans, initProviderKeys, validateAdminLogins, selfTestAdminLogin } from "./lib/bootstrap";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  assertProductionSecrets();
  await ensureInitialAdmin();
  await validateAdminLogins();
  await ensureDefaultPlans();
  
  await initProviderKeys().catch((err) =>
    logger.warn({ err }, "Provider key init failed (non-fatal)")
  );

  const retentionMs = Number(process.env.MEDIA_RETENTION_INTERVAL_MS ?? `${60 * 60 * 1000}`);
  if (retentionMs > 0) {
    const tick = () => {
      purgeExpiredMediaBlobs().catch((e) => logger.error({ err: e }, "Media retention purge failed"));
    };
    tick();
    setInterval(tick, retentionMs);
  }

  app.listen(port, async (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    // HTTP-level self-test — verify admin login works end-to-end via the
    // live server.  Non-fatal: logs a loud error but doesn't crash.
    try {
      await selfTestAdminLogin(port);
    } catch (e) {
      logger.error({ err: e }, "Admin login self-test failed (non-fatal)");
    }
  });
}

start().catch((err) => {
  logger.error({ err }, "Failed to initialize server");
  process.exit(1);
});
