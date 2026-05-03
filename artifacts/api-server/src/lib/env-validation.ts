/**
 * Fail fast on insecure production configuration.
 */
export function assertProductionSecrets(): void {
  if (process.env.NODE_ENV !== "production") {
    return;
  }
  const secret = process.env.SESSION_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error(
      "SESSION_SECRET must be set to a random string of at least 32 characters in production.",
    );
  }
}
