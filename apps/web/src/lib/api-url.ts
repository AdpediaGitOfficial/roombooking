/**
 * Where the API service listens. Accepts a full URL or a bare `host:port`
 * (as hosting platforms hand out for private services), and drops a trailing slash.
 */
export function apiUrl(raw: string | undefined = process.env.API_URL): string {
  const value = (raw ?? "").trim() || "http://127.0.0.1:4000";
  const withScheme = /^https?:\/\//i.test(value) ? value : `http://${value}`;
  return withScheme.replace(/\/+$/, "");
}
