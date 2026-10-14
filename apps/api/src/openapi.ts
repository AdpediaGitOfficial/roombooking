import { z } from "zod";
import type { Contract, OpDef } from "@sam/contract/define";

type Schema = Record<string, unknown>;

function paramNames(path: string): string[] {
  return [...path.matchAll(/:([A-Za-z0-9_]+)/g)].map((m) => m[1]);
}

/** Builds an OpenAPI 3.1 document from the contract, so the documentation cannot drift from the code. */
export function buildOpenApi(contract: Contract, info: { title: string; version: string; description?: string }) {
  const paths: Record<string, Record<string, unknown>> = {};
  const tags = new Set<string>();

  for (const ops of Object.values(contract)) {
    for (const def of Object.values(ops) as OpDef[]) {
      tags.add(def.tag);
      const oaPath = def.path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
      const schema = z.toJSONSchema(def.input, { unrepresentable: "any", io: "input" }) as Schema & { properties?: Record<string, Schema>; required?: string[] };
      const props = schema.properties ?? {};
      const required = new Set(schema.required ?? []);
      const pathKeys = paramNames(def.path);
      const parameters: unknown[] = pathKeys.map((name) => ({ name, in: "path", required: true, schema: props[name] ?? { type: "string" } }));
      const rest = Object.keys(props).filter((k) => !pathKeys.includes(k));
      let requestBody: unknown;
      if (def.method === "GET" || def.method === "DELETE") {
        for (const name of rest) parameters.push({ name, in: "query", required: required.has(name), schema: props[name] });
      } else if (rest.length > 0) {
        const bodySchema = { type: "object", properties: Object.fromEntries(rest.map((k) => [k, props[k]])), required: rest.filter((k) => required.has(k)) };
        requestBody = { required: bodySchema.required.length > 0, content: { [def.multipart ? "multipart/form-data" : "application/json"]: { schema: bodySchema } } };
      }
      const roles = Array.isArray(def.access) ? def.access : null;
      const operation = {
        operationId: def.id,
        summary: def.summary,
        description: roles ? `Allowed roles: ${roles.map(String).join(", ")}.` : def.access === "public" ? "No sign-in required." : "Any signed-in user.",
        tags: [def.tag],
        security: def.access === "public" ? [] : [{ bearerAuth: [] }],
        parameters: parameters.length ? parameters : undefined,
        requestBody,
        responses: {
          "200": def.kind === "file" ? { description: "File download", content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } } } : { description: "Success. JSON result; timestamps are ISO 8601." },
          "401": { description: "Missing or invalid session token" },
          "403": { description: "The signed-in user lacks the required role" },
          "422": { description: "Validation failed; fieldErrors names the fields" },
          "429": { description: "Rate limit exceeded" },
        },
      };
      (paths[oaPath] ??= {})[def.method.toLowerCase()] = operation;
    }
  }

  return {
    openapi: "3.1.0",
    info,
    tags: [...tags].sort().map((name) => ({ name })),
    components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "Session token from POST /v1/auth/login" } } },
    paths,
  };
}
