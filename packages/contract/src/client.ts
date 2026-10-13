import { ApiError, type ErrorBody } from "./errors";
import type { Contract, FileInput, FileResult, InputOf, OpDef, OutputOf } from "./define";

type OpFn<D> = D extends OpDef<never, never, never>
  ? never
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  : {} extends InputOf<D>
    ? (input?: InputOf<D>) => Promise<OutputOf<D>>
    : (input: InputOf<D>) => Promise<OutputOf<D>>;

export type Client<C extends Contract> = { [M in keyof C]: { [K in keyof C[M]]: OpFn<C[M][K]> } };

export interface ClientOptions {
  /** API origin including the version prefix is not needed: paths already start with /v1. */
  baseUrl: string;
  /** Session token to send as a bearer token. */
  token?: () => string | null | undefined | Promise<string | null | undefined>;
  /** Extra headers on every request, for example a forwarded client address. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
/** JSON.parse reviver that turns ISO timestamps back into Dates, as the services return them. */
export function reviveDates(_key: string, value: unknown): unknown {
  return typeof value === "string" && ISO_TIMESTAMP.test(value) ? new Date(value) : value;
}

function scalar(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function isFile(v: unknown): v is FileInput {
  return !!v && typeof v === "object" && "bytes" in v && "fileName" in v;
}

export function createClient<C extends Contract>(contract: C, options: ClientOptions): Client<C> {
  const base = options.baseUrl.replace(/\/$/, "");
  const doFetch = options.fetch ?? fetch;
  const client: Record<string, Record<string, unknown>> = {};

  for (const [moduleName, ops] of Object.entries(contract)) {
    client[moduleName] = {};
    for (const [opName, def] of Object.entries(ops)) {
      client[moduleName][opName] = async (input: Record<string, unknown> = {}) => {
        const params: Record<string, unknown> = { ...input };
        const path = def.path.replace(/:([A-Za-z0-9_]+)/g, (_m, key: string) => {
          const value = params[key];
          delete params[key];
          return encodeURIComponent(String(value));
        });
        const url = new URL(base + path);
        const headers: Record<string, string> = { accept: def.kind === "file" ? "*/*" : "application/json", ...(await options.headers?.()) };
        const token = await options.token?.();
        if (token) headers.authorization = `Bearer ${token}`;

        let body: BodyInit | undefined;
        if (def.method === "GET" || def.method === "DELETE") {
          for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue;
            if (Array.isArray(v)) for (const item of v) url.searchParams.append(k, scalar(item));
            else url.searchParams.set(k, scalar(v));
          }
        } else if (def.multipart) {
          const form = new FormData();
          for (const [k, v] of Object.entries(params)) {
            if (v === undefined || v === null) continue;
            if (isFile(v)) form.append(k, new Blob([v.bytes as BlobPart]), v.fileName);
            else if (Array.isArray(v) && v.length > 0 && v.every(isFile)) for (const f of v) form.append(k, new Blob([f.bytes as BlobPart]), f.fileName);
            else if (Array.isArray(v) || (typeof v === "object" && !(v instanceof Date))) form.append(k, JSON.stringify(v));
            else form.append(k, scalar(v));
          }
          body = form;
        } else {
          headers["content-type"] = "application/json";
          body = JSON.stringify(params);
        }

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);
        let res: Response;
        try {
          res = await doFetch(url, { method: def.method, headers, body, signal: controller.signal, cache: "no-store" } as RequestInit);
        } catch (error) {
          throw new ApiError(503, "UNAVAILABLE", error instanceof Error && error.name === "AbortError" ? "The service took too long to respond." : "The service is not reachable.");
        } finally {
          clearTimeout(timer);
        }

        if (!res.ok) {
          let parsed: ErrorBody | null = null;
          try { parsed = (await res.json()) as ErrorBody; } catch { /* not JSON */ }
          throw new ApiError(res.status, parsed?.error.code ?? "ERROR", parsed?.error.message ?? `Request failed (${res.status}).`, parsed?.error.fieldErrors ?? {}, parsed?.error.requestId);
        }
        if (def.kind === "file") {
          const disposition = res.headers.get("content-disposition") ?? "";
          const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1];
          return { body: new Uint8Array(await res.arrayBuffer()), contentType: res.headers.get("content-type") ?? "application/octet-stream", fileName: name } satisfies FileResult;
        }
        if (res.status === 204) return undefined;
        const text = await res.text();
        return text ? JSON.parse(text, reviveDates) : undefined;
      };
    }
  }
  return client as Client<C>;
}
