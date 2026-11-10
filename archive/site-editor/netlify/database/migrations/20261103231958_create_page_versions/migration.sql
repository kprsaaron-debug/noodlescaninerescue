CREATE TABLE "page_versions" (
	"id" serial PRIMARY KEY,
	"page" text NOT NULL,
	"action" text NOT NULL,
	"html" text,
	"note" text,
	"author_email" text NOT NULL,
	"author_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "page_versions_page_created_idx" ON "page_versions" ("page","created_at");