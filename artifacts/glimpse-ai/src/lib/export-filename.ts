/**
 * Download filename: `{original}-{enhancement}-{YYYYMMDD}-{shortRef}.{ext}`
 */
export function buildEnhancedDownloadName(opts: {
  originalFilename: string;
  enhancementType: string;
  referenceCode?: string | null;
  mime: string;
}): string {
  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 120);
  const base = sanitize(opts.originalFilename.replace(/\.[^.]+$/, "")) || "output";
  const enh = sanitize(opts.enhancementType).slice(0, 48) || "enh";
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const shortRef = opts.referenceCode?.split("-").pop() ?? "ref";

  let ext = ".jpg";
  const m = opts.mime.toLowerCase();
  if (m === "image/png") ext = ".png";
  else if (m === "image/webp") ext = ".webp";
  else if (m.includes("mp4") || m === "video/mp4") ext = ".mp4";

  return `${base}-${enh}-${date}-${shortRef}${ext}`;
}
