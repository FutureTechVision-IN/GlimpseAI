import { google, type drive_v3 } from "googleapis";
import { Readable } from "node:stream";
import { logger } from "./logger";

const DEFAULT_DRIVE_FOLDER_ID = "17-NtAES7W6ua0FS7mqYX3-thbRkQkLQG";
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"];

export interface StoreMediaInput {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  userId: number;
  jobId: number;
  role: "original" | "processed" | "thumbnail";
}

export interface StoredMedia {
  provider: "google-drive";
  fileId: string;
  url: string;
  downloadUrl: string;
}

let driveClientPromise: Promise<drive_v3.Drive | null> | null = null;
let warnedMissingConfig = false;

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, "\n");
}

function getDriveFolderId(): string {
  return process.env.GOOGLE_DRIVE_FOLDER_ID?.trim() || DEFAULT_DRIVE_FOLDER_ID;
}

function shouldMakeDriveFilesPublic(): boolean {
  return process.env.GOOGLE_DRIVE_MAKE_PUBLIC !== "false";
}

function sanitizeFilename(value: string): string {
  return value
    .replace(/[^\w.\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 160) || "media";
}

function buildStoredName(input: StoreMediaInput): string {
  const ext = input.filename.includes(".") ? "" : extensionFromMime(input.mimeType);
  return [
    "glimpse",
    `user-${input.userId}`,
    `job-${input.jobId}`,
    input.role,
    `${sanitizeFilename(input.filename)}${ext}`,
  ].join("-");
}

function extensionFromMime(mimeType: string): string {
  if (mimeType.includes("png")) return ".png";
  if (mimeType.includes("webp")) return ".webp";
  if (mimeType.includes("mp4")) return ".mp4";
  if (mimeType.includes("quicktime")) return ".mov";
  return ".jpg";
}

async function getDriveClient(): Promise<drive_v3.Drive | null> {
  if (!driveClientPromise) {
    driveClientPromise = (async () => {
      const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
      const privateKey = process.env.GOOGLE_PRIVATE_KEY?.trim();

      if (clientEmail && privateKey) {
        const auth = new google.auth.JWT({
          email: clientEmail,
          key: normalizePrivateKey(privateKey),
          scopes: DRIVE_SCOPES,
        });
        return google.drive({ version: "v3", auth });
      }

      if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        const auth = new google.auth.GoogleAuth({ scopes: DRIVE_SCOPES });
        return google.drive({ version: "v3", auth });
      }

      if (!warnedMissingConfig) {
        warnedMissingConfig = true;
        logger.warn(
          {
            folderId: getDriveFolderId(),
            required: ["GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_PRIVATE_KEY", "or GOOGLE_APPLICATION_CREDENTIALS"],
          },
          "Google Drive media storage is not configured; falling back to database data URIs",
        );
      }
      return null;
    })();
  }

  return driveClientPromise;
}

export function isExternalMediaStorageConfigured(): boolean {
  return Boolean(
    (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && process.env.GOOGLE_PRIVATE_KEY) ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
  );
}

export function toDataUri(base64: string | null, mimeType = "image/jpeg"): string | null {
  if (!base64) return null;
  if (base64.startsWith("data:")) return base64;
  return `data:${mimeType};base64,${base64}`;
}

export async function storeMediaFile(input: StoreMediaInput): Promise<StoredMedia | null> {
  const drive = await getDriveClient();
  if (!drive) return null;

  const folderId = getDriveFolderId();
  const name = buildStoredName(input);

  try {
    const created = await drive.files.create({
      requestBody: {
        name,
        parents: [folderId],
        mimeType: input.mimeType,
      },
      media: {
        mimeType: input.mimeType,
        body: Readable.from(input.buffer),
      },
      fields: "id, webViewLink, webContentLink",
      supportsAllDrives: true,
    });

    const fileId = created.data.id;
    if (!fileId) throw new Error("Google Drive did not return a file id");

    if (shouldMakeDriveFilesPublic()) {
      await drive.permissions.create({
        fileId,
        requestBody: {
          role: "reader",
          type: "anyone",
        },
        supportsAllDrives: true,
      });
    }

    return {
      provider: "google-drive",
      fileId,
      url: `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`,
      downloadUrl: `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`,
    };
  } catch (err) {
    logger.error({ err, folderId, role: input.role, jobId: input.jobId }, "Failed to store media in Google Drive");
    return null;
  }
}
