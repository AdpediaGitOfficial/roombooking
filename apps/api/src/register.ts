import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";
import type { Access, Contract, FileInput, OpDef, OutputOf, ParsedOf } from "@sam/contract/define";
import { HttpError } from "./http-error";
import { bearerToken, hasAnyRole, unauthenticated, type AuthUser, type Authenticator } from "./auth";

export interface PublicCtx { user: null; token: null; ip: string; requestId: string; request: FastifyRequest; auth: Authenticator }
export interface AuthedCtx { user: AuthUser; token: string; ip: string; requestId: string; request: FastifyRequest; auth: Authenticator }
export type Ctx<A extends Access> = A extends "public" ? PublicCtx : AuthedCtx;

export type Handler<D> = D extends OpDef<z.ZodType, unknown, infer A>
  ? (ctx: Ctx<A>, input: ParsedOf<D>) => Promise<OutputOf<D>> | OutputOf<D>
  : never;

/** One handler per operation in the contract; a missing handler is a compile error. */
export type Handlers<C extends Contract> = { [M in keyof C]: { [K in keyof C[M]]: Handler<C[M][K]> } };

declare module "fastify" {
  interface FastifyContextConfig {
    opId?: string;
  }
}

const toFastifyPath = (p: string) => p;

/** Reads the request's path, query and body into one object; multipart bodies may carry files. */
async function collectInput(request: FastifyRequest, def: OpDef, maxUploadBytes: number): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  Object.assign(out, request.query as Record<string, unknown>);
  if (def.method !== "GET" && def.method !== "DELETE") {
    if (def.multipart && request.isMultipart()) {
      for await (const part of request.parts({ limits: { fileSize: maxUploadBytes, files: 5 } })) {
        if (part.type === "file") {
          const bytes = await part.toBuffer();
          if (part.file.truncated) throw new HttpError(413, "TOO_LARGE", `Files must be ${Math.round(maxUploadBytes / 1024 / 1024)} MB or smaller.`);
          if (bytes.length === 0 || !part.filename) continue;
          out[part.fieldname] = { bytes: new Uint8Array(bytes), fileName: part.filename } satisfies FileInput;
        } else {
          const existing = out[part.fieldname];
          const value = String(part.value ?? "");
          out[part.fieldname] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
        }
      }
    } else if (request.body && typeof request.body === "object") {
      Object.assign(out, request.body as Record<string, unknown>);
    }
  }
  Object.assign(out, request.params as Record<string, unknown>);
  return out;
}

export interface RegisterOptions {
  authenticator: Authenticator;
  maxUploadBytes: number;
}

export function registerOps<C extends Contract>(app: FastifyInstance, contract: C, handlers: Handlers<C>, options: RegisterOptions) {
  const seen = new Set<string>();
  for (const [moduleName, ops] of Object.entries(contract)) {
    for (const [opName, def] of Object.entries(ops)) {
      if (seen.has(def.id)) throw new Error(`Duplicate operation id ${def.id}`);
      seen.add(def.id);
      const handler = (handlers as unknown as Record<string, Record<string, (ctx: unknown, input: unknown) => unknown>>)[moduleName]?.[opName];
      if (!handler) throw new Error(`No handler for ${def.id}`);

      app.route({
        method: def.method,
        url: toFastifyPath(def.path),
        config: {
          opId: def.id,
          ...(def.rateLimit ? { rateLimit: { max: def.rateLimit.max, timeWindow: def.rateLimit.windowSeconds * 1000 } } : {}),
        },
        handler: async (request, reply) => {
          let user: AuthUser | null = null;
          const token = bearerToken(request);
          if (def.access !== "public") {
            if (!token) throw unauthenticated();
            user = await options.authenticator.authenticate(token);
            if (!user) throw unauthenticated();
            if (Array.isArray(def.access) && !hasAnyRole(user, def.access)) {
              throw new HttpError(403, "FORBIDDEN", "You do not have permission to do that.");
            }
          }
          const raw = await collectInput(request, def, options.maxUploadBytes);
          const parsed = def.input.safeParse(raw);
          if (!parsed.success) throw parsed.error;
          const ctx = { user, token: user ? token : null, ip: request.ip, requestId: request.id, request, auth: options.authenticator };
          const result = await handler(ctx, parsed.data);
          if (def.kind === "file") {
            const file = result as { body: Uint8Array; contentType: string; fileName?: string };
            reply.header("content-type", file.contentType);
            if (file.fileName) reply.header("content-disposition", `attachment; filename="${file.fileName.replace(/"/g, "")}"`);
            reply.header("cache-control", "private, no-store");
            return reply.send(Buffer.from(file.body));
          }
          if (result === undefined) return reply.code(204).send();
          return reply.send(result);
        },
      });
    }
  }
}
