import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

// Every save of a page creates one row, so the full edit history is kept and
// any earlier version can be restored.
//   action = "draft"   → saved but not live
//   action = "publish" → this HTML is what visitors see
//   action = "revert"  → the page was reset to the original built-in version
export const pageVersions = pgTable(
  "page_versions",
  {
    id: serial().primaryKey(),
    page: text().notNull(),
    action: text().notNull(),
    html: text(),
    note: text(),
    authorEmail: text("author_email").notNull(),
    authorName: text("author_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("page_versions_page_created_idx").on(t.page, t.createdAt)],
);
