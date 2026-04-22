/**
 * local-history.ts — IndexedDB-backed local image history.
 *
 * Stores only the 5 most recent photo enhancements.
 * Videos are excluded (too large). Data lives entirely in the browser;
 * clearing browser storage erases it. Not synced across devices.
 */

const DB_NAME = "glimpse_history";
const DB_VERSION = 1;
const STORE_NAME = "images";
const MAX_ITEMS = 5;

export interface LocalHistoryItem {
  /** Auto-incremented key */
  id?: number;
  /** Original file name */
  filename: string;
  /** Enhancement type (auto, portrait, filter, etc.) */
  enhancementType: string;
  /** data-URI of the enhanced image (base64) */
  dataUri: string;
  /** Thumbnail data-URI (smaller, for grid preview) */
  thumbnailUri: string;
  /** Thumbnail of the original image (for side-by-side comparison) */
  originalThumbnailUri?: string;
  /** MIME type */
  mimeType: string;
  /** When the enhancement was created */
  createdAt: string;
  /** Processing time in milliseconds */
  processingTimeMs?: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Generate a small thumbnail (max 300px wide) to save space in grid view */
function createThumbnail(dataUri: string, maxWidth = 300): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxWidth / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d")!;
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.7));
    };
    img.onerror = () => resolve(dataUri); // fallback: use original
    img.src = dataUri;
  });
}

/** Save a new history entry. Automatically prunes to MAX_ITEMS. */
export async function saveToHistory(item: Omit<LocalHistoryItem, "id" | "thumbnailUri" | "createdAt">): Promise<void> {
  const db = await openDB();
  const thumbnailUri = await createThumbnail(item.dataUri);
  const originalThumbnailUri = item.originalThumbnailUri
    ? await createThumbnail(item.originalThumbnailUri)
    : undefined;
  const entry: Omit<LocalHistoryItem, "id"> = {
    ...item,
    thumbnailUri,
    originalThumbnailUri,
    createdAt: new Date().toISOString(),
  };

  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);

  // Add the new entry
  store.add(entry);

  // Count and prune if needed
  const countReq = store.count();
  countReq.onsuccess = () => {
    const excess = countReq.result - MAX_ITEMS;
    if (excess > 0) {
      // Delete the oldest entries (lowest IDs)
      const cursorReq = store.openCursor();
      let deleted = 0;
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor && deleted < excess) {
          cursor.delete();
          deleted++;
          cursor.continue();
        }
      };
    }
  };

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Get all history entries, newest first. */
export async function getHistory(): Promise<LocalHistoryItem[]> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readonly");
  const store = tx.objectStore(STORE_NAME);
  return new Promise((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => {
      const items = (req.result as LocalHistoryItem[]).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
      resolve(items);
    };
    req.onerror = () => reject(req.error);
  });
}

/** Delete a single entry by ID. */
export async function deleteHistoryItem(id: number): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).delete(id);
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Clear all history. */
export async function clearHistory(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(STORE_NAME, "readwrite");
  tx.objectStore(STORE_NAME).clear();
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
