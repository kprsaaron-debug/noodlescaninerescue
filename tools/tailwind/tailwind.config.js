// Tailwind v3.4.17 config for the static site. Rebuild public/styles.css after changing classes:
//   npx tailwindcss@3.4.17 -c tools/tailwind/tailwind.config.js -i tools/tailwind/input.css -o public/styles.css --minify
// Run from the repo root. The CSS file is committed, so Netlify needs no build step.
module.exports = {
  content: ['./public/**/*.html'],
  // Classes toggled by the menu script.
  safelist: ['hidden', 'block', 'flex'],
  theme: { extend: {} },
  plugins: [],
}
