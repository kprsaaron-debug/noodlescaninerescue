import type { Config } from "@netlify/functions";
import { getStore } from "@netlify/blobs";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { pageVersions } from "../../db/schema.js";
import { PAGES, PUBLISHED_STORE, UPLOADS_STORE, isPageKey } from "../../lib/pages.js";
import { getEditor, isSameOrigin, json } from "../../lib/auth.js";

const MAX_HTML_BYTES = 2_000_000;
const MAX_UPLOAD_BYTES = 10_000_000;
const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

const versionSummary = {
  id: pageVersions.id,
  page: pageVersions.page,
  action: pageVersions.action,
  note: pageVersions.note,
  authorEmail: pageVersions.authorEmail,
  authorName: pageVersions.authorName,
  createdAt: pageVersions.createdAt,
};

export default async (req: Request) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/admin\/?/, "").split("/").filter(Boolean);
  const { user, allowed } = await getEditor();

  // GET /api/admin/me — lets the dashboard know who is signed in.
  if (parts[0] === "me" && req.method === "GET") {
    return json({
      signedIn: !!user,
      allowed,
      email: user?.email ?? null,
      name: user?.name ?? null,
    });
  }

  if (!user) return json({ error: "Please sign in." }, 401);
  if (!allowed) return json({ error: "This account does not have access to the dashboard." }, 403);
  if (req.method !== "GET" && !isSameOrigin(req)) return json({ error: "Invalid request origin." }, 403);

  const author = { authorEmail: user.email ?? user.id, authorName: user.name ?? null };

  try {
    // GET /api/admin/pages — overview of every page and its latest change.
    if (parts[0] === "pages" && parts.length === 1 && req.method === "GET") {
      const rows = await db
        .selectDistinctOn([pageVersions.page], versionSummary)
        .from(pageVersions)
        .where(inArray(pageVersions.page, PAGES.map((p) => p.key)))
        .orderBy(pageVersions.page, desc(pageVersions.createdAt), desc(pageVersions.id));
      const lastLive = await db
        .selectDistinctOn([pageVersions.page], versionSummary)
        .from(pageVersions)
        .where(inArray(pageVersions.action, ["publish", "revert"]))
        .orderBy(pageVersions.page, desc(pageVersions.createdAt), desc(pageVersions.id));
      return json({
        pages: PAGES.map((p) => {
          const latest = rows.find((r) => r.page === p.key) ?? null;
          const live = lastLive.find((r) => r.page === p.key) ?? null;
          return {
            ...p,
            latest,
            hasUnpublishedDraft: latest?.action === "draft",
            isCustomised: live?.action === "publish",
          };
        }),
      });
    }

    // /api/admin/pages/:key
    if (parts[0] === "pages" && parts[1]) {
      const key = parts[1];
      if (!isPageKey(key)) return json({ error: "Unknown page." }, 404);

      if (parts.length === 2 && req.method === "GET") {
        const versions = await db
          .select(versionSummary)
          .from(pageVersions)
          .where(eq(pageVersions.page, key))
          .orderBy(desc(pageVersions.createdAt), desc(pageVersions.id))
          .limit(100);
        const latestWithHtml = versions.find((v) => v.action !== "revert");
        const latest = versions[0];
        // Open the most recent saved work; after a reset, start from the original file.
        let html: string | null = null;
        let source: "draft" | "published" | "original" = "original";
        if (latest && latest.action !== "revert" && latestWithHtml) {
          const [row] = await db
            .select({ html: pageVersions.html })
            .from(pageVersions)
            .where(eq(pageVersions.id, latestWithHtml.id));
          html = row?.html ?? null;
          source = latest.action === "draft" ? "draft" : "published";
        }
        return json({ key, html, source, versions });
      }

      // POST /api/admin/pages/:key  { html, action: "draft" | "publish", note? }
      if (parts.length === 2 && req.method === "POST") {
        const body = await req.json().catch(() => null);
        const html = typeof body?.html === "string" ? body.html : "";
        const action = body?.action === "publish" ? "publish" : "draft";
        const note = typeof body?.note === "string" ? body.note.slice(0, 500) : null;
        if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) {
          return json({ error: "The page HTML looks incomplete, so it was not saved." }, 400);
        }
        if (new TextEncoder().encode(html).length > MAX_HTML_BYTES) {
          return json({ error: "The page is too large to save." }, 400);
        }
        if (action === "publish") {
          await getStore({ name: PUBLISHED_STORE, consistency: "strong" }).set(key, html);
        }
        const [saved] = await db
          .insert(pageVersions)
          .values({ page: key, action, html, note, ...author })
          .returning(versionSummary);
        return json({ saved });
      }

      // POST /api/admin/pages/:key/revert — go back to the original built-in page.
      if (parts[2] === "revert" && req.method === "POST") {
        await getStore({ name: PUBLISHED_STORE, consistency: "strong" }).delete(key);
        const [saved] = await db
          .insert(pageVersions)
          .values({ page: key, action: "revert", html: null, note: "Reset to original", ...author })
          .returning(versionSummary);
        return json({ saved });
      }
    }

    // GET /api/admin/versions/:id — full HTML of a past version.
    if (parts[0] === "versions" && parts[1] && req.method === "GET") {
      const id = Number(parts[1]);
      if (!Number.isInteger(id)) return json({ error: "Unknown version." }, 404);
      const [row] = await db.select().from(pageVersions).where(and(eq(pageVersions.id, id)));
      if (!row) return json({ error: "Unknown version." }, 404);
      return json(row);
    }

    // GET /api/admin/media — images uploaded so far.
    if (parts[0] === "media" && req.method === "GET") {
      const { blobs } = await getStore(UPLOADS_STORE).list();
      const items = blobs
        .map((b) => ({ key: b.key, url: `/uploads/${b.key}` }))
        .sort((a, b) => b.key.localeCompare(a.key));
      return json({ items });
    }

    // POST /api/admin/upload — multipart form with a "file" field.
    if (parts[0] === "upload" && req.method === "POST") {
      const form = await req.formData().catch(() => null);
      const file = form?.get("file");
      if (!(file instanceof File)) return json({ error: "No file received." }, 400);
      const ext = IMAGE_TYPES[file.type];
      if (!ext) return json({ error: "Please upload a JPG, PNG, WebP, GIF, AVIF or SVG image." }, 400);
      if (file.size > MAX_UPLOAD_BYTES) return json({ error: "Images must be under 10 MB." }, 400);
      const base =
        file.name
          .replace(/\.[^.]+$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 60) || "image";
      const key = `${Date.now()}-${base}.${ext}`;
      await getStore(UPLOADS_STORE).set(key, await file.arrayBuffer(), {
        metadata: { contentType: file.type },
      });
      return json({ key, url: `/uploads/${key}` }, 201);
    }

    return json({ error: "Not found." }, 404);
  } catch (err) {
    console.error("Admin API error", err);
    return json({ error: "Something went wrong on the server. Please try again." }, 500);
  }
};

export const config: Config = {
  path: "/api/admin/*",
};
