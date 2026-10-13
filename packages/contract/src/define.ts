import { z } from "zod";
import type { Role } from "@prisma/client";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Who may call an operation: anyone, any signed-in user, or users holding one of the roles. */
export type Access = "public" | "authenticated" | readonly Role[];

/** Phantom marker that carries an operation's result type. */
export type Out<T> = { readonly __type?: T };
export const out = <T>(): Out<T> => ({});

export interface OpDef<I extends z.ZodType = z.ZodType, O = unknown, A extends Access = Access> {
  /** "module.operation", unique across the contract. */
  readonly id: string;
  readonly method: HttpMethod;
  /** Express-style path below the API root, e.g. "/v1/work-orders/:id". */
  readonly path: string;
  readonly summary: string;
  readonly tag: string;
  readonly access: A;
  /** One object holding path parameters, query parameters and body fields. */
  readonly input: I;
  /** "file" operations return bytes (downloads, photos) instead of JSON. */
  readonly kind: "json" | "file";
  /** The request is multipart/form-data and may carry a file. */
  readonly multipart: boolean;
  readonly rateLimit?: { readonly max: number; readonly windowSeconds: number };
  readonly _out?: O;
}

export interface OpInit<I extends z.ZodType, O, A extends Access> {
  id: string;
  method: HttpMethod;
  path: string;
  summary: string;
  tag: string;
  access?: A;
  input: I;
  output?: Out<O>;
  kind?: "json" | "file";
  multipart?: boolean;
  rateLimit?: { max: number; windowSeconds: number };
}

export function op<I extends z.ZodType, O = unknown, const A extends Access = "authenticated">(init: OpInit<I, O, A>): OpDef<I, O, A> {
  return {
    id: init.id,
    method: init.method,
    path: init.path,
    summary: init.summary,
    tag: init.tag,
    access: (init.access ?? "authenticated") as A,
    input: init.input,
    kind: init.kind ?? "json",
    multipart: init.multipart ?? false,
    rateLimit: init.rateLimit,
  };
}

/** An operation that returns bytes (a download or a photo) instead of JSON. */
export function fileOp<I extends z.ZodType, const A extends Access = "authenticated">(init: Omit<OpInit<I, FileResult, A>, "kind" | "output" | "multipart">): OpDef<I, FileResult, A> {
  return op<I, FileResult, A>({ ...init, kind: "file", output: out<FileResult>() });
}

export type Contract = Record<string, Record<string, OpDef<z.ZodType, unknown, Access>>>;

/** The (awaited) result type of a service function, for declaring an operation's output. */
export type Ret<F> = F extends (...args: never[]) => infer R ? Awaited<R> : never;

/** What a caller passes to an operation. */
export type InputOf<D> = D extends OpDef<infer I, unknown, Access> ? z.input<I> : never;
/** What a handler receives after validation. */
export type ParsedOf<D> = D extends OpDef<infer I, unknown, Access> ? z.output<I> : never;
export type OutputOf<D> = D extends OpDef<z.ZodType, infer O, Access> ? O : never;

/** Bytes returned by "file" operations. */
export type FileResult = { body: Uint8Array; contentType: string; fileName?: string };

/** A file sent with a multipart request. */
export type FileInput = { bytes: Uint8Array; fileName: string };

// Input helpers: query strings arrive as text, so numbers, booleans and dates coerce.
export const fileInput = z.custom<FileInput>((v) => !!v && typeof v === "object" && "bytes" in v && "fileName" in v, "Expected a file");
/** Zero to `max` files sent under one field name (a single file is accepted as a one-item list). */
export const fileList = (max = 5) => z.preprocess((v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]), z.array(fileInput).max(max)) as unknown as z.ZodType<FileInput[], FileInput[] | undefined>;
export function int(opts: { min?: number; max?: number; default: number }): z.ZodDefault<z.ZodNumber>;
export function int(opts?: { min?: number; max?: number }): z.ZodNumber;
export function int(opts: { min?: number; max?: number; default?: number } = {}) {
  let s = z.coerce.number().int();
  if (opts.min !== undefined) s = s.min(opts.min);
  if (opts.max !== undefined) s = s.max(opts.max);
  // Typed as a plain number so callers may omit a defaulted field; at runtime strings from a query still coerce.
  return opts.default !== undefined ? s.default(opts.default) : s;
}
export const bool = () => z.union([z.boolean(), z.stringbool()]);
/** A calendar date as YYYY-MM-DD. */
export const isoDate = () => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD");
/** A timestamp; accepts ISO text and returns a Date. */
export const timestamp = () => z.coerce.date();
export const cuid = () => z.string().min(1).max(64);
/** A JSON value sent as text in a multipart form. */
export const jsonField = <T extends z.ZodType>(schema: T) => z.preprocess((v) => (typeof v === "string" ? JSON.parse(v) : v), schema);

/** Page controls shared by every long list. */
export const pageInput = { page: int({ min: 1, default: 1 }), pageSize: int({ min: 1, max: 100, default: 50 }) };
