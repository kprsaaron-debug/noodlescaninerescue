// The editable pages of the site. `key` is the HTML file name without ".html".
export const PAGES = [
  { key: "index", title: "Home", path: "/" },
  { key: "about", title: "About Us", path: "/about" },
  { key: "k9-first-aid", title: "K9 First Aid", path: "/k9-first-aid" },
  { key: "report-missing-dog", title: "Report Missing Dog", path: "/report-missing-dog" },
  { key: "news", title: "News & Updates", path: "/news" },
  { key: "volunteer", title: "Volunteer", path: "/volunteer" },
] as const;

export type PageKey = (typeof PAGES)[number]["key"];

export const isPageKey = (k: string): k is PageKey => PAGES.some((p) => p.key === k);

// Blob store holding the currently published HTML for each edited page.
export const PUBLISHED_STORE = "published-pages";
// Blob store holding images uploaded through the dashboard.
export const UPLOADS_STORE = "uploads";
