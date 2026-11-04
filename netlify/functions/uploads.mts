import type { Config, Context } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { UPLOADS_STORE } from "../../lib/pages.js";

// Serves images uploaded through the admin dashboard.
export default async (_req: Request, context: Context) => {
  const key = context.params.key;
  if (!key) return new Response("Not found", { status: 404 });
  const result = await getStore(UPLOADS_STORE).getWithMetadata(key, { type: "arrayBuffer" });
  if (!result) return new Response("Not found", { status: 404 });
  const type = String(result.metadata?.contentType ?? "application/octet-stream");
  const headers: Record<string, string> = {
    "content-type": type,
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff",
  };
  if (type === "image/svg+xml") headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'";
  return new Response(result.data, { headers });
};

export const config: Config = {
  path: "/uploads/:key",
};
