import type { Config, Context } from "@netlify/edge-functions";
import { getStore } from "@netlify/blobs";
import { PUBLISHED_STORE } from "../../lib/pages.ts";

// Serves the version of a page published from the admin dashboard. When a page
// has never been edited (or was reset), the request falls through to the
// original static HTML file.
export default async (req: Request, _context: Context) => {
  const url = new URL(req.url);
  if (url.searchParams.has("cms-original")) return;

  let name = url.pathname.replace(/^\/+|\/+$/g, "").replace(/\.html$/, "");
  if (name === "") name = "index";

  try {
    const store = getStore({ name: PUBLISHED_STORE, consistency: "strong" });
    const html = await store.get(name, { type: "text" });
    if (html === null) return;
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=0, must-revalidate",
      },
    });
  } catch (err) {
    console.error("Failed to load published page", name, err);
    return;
  }
};

export const config: Config = {
  path: [
    "/", "/index", "/index.html",
    "/about", "/about.html",
    "/k9-first-aid", "/k9-first-aid.html",
    "/report-missing-dog", "/report-missing-dog.html",
    "/news", "/news.html",
    "/volunteer", "/volunteer.html",
  ],
};
