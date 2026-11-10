# Archive

Nothing in this folder is built or deployed: Netlify publishes only `public/`, and there is no build command, no `netlify/functions` and no `netlify/edge-functions` folder any more.

## site-editor/
The retired in-browser site editor (Netlify Identity login, Netlify Blobs saved pages, Netlify Database version history, a serverless API and an edge function that served saved pages on every request). Retired on 10 Nov 2026 to cut Netlify credit use. Edits are now requested through the internal form at `/request-change.html` and made in Git.

To bring it back, move the contents back to the repo root (`netlify/`, `lib/`, `db/`, `admin-src/`, `package.json`, `public-admin/` becomes `public/admin/`), restore the `npm run build` command in `netlify.toml`, and re-enable Identity and the database in Netlify.

## blobs-backup/
Copy of the Netlify Blobs store `published-pages` taken on 10 Nov 2026 before the editor was retired. It held one saved page, `about`. The `uploads` store was empty. The original blobs are still in Netlify as a second backup.
