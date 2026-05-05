const rawApiBaseUrl = (import.meta.env.VITE_API_URL as string | undefined)?.trim();
const apiBaseUrl = rawApiBaseUrl ? rawApiBaseUrl.replace(/\/+$/, "") : "";

export function apiUrl(path: string): string {
  if (!apiBaseUrl || !path.startsWith("/")) {
    return path;
  }
  return `${apiBaseUrl}${path}`;
}
