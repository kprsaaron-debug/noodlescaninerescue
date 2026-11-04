import {
  login,
  logout,
  getUser,
  signup,
  handleAuthCallback,
  requestPasswordRecovery,
  updateUser,
  acceptInvite,
  AuthError,
  MissingIdentityError,
} from "@netlify/identity";
import { $, $$, api, esc, toast, confirmBox, timeAgo, formatWhen, personName } from "./util.js";
import { createEditor } from "./editor.js";

const SITE_IMAGES = [
  "hero-bg.png", "ncr-logo.png", "noodle.jpg", "volunteer-briefing.jpg", "dog-handler-stream.jpg", "royal-show-stand.jpg",
  "first-aid-training.jpg", "pet-first-aid-kit.jpg", "level2-first-aid-card.png", "our-teams-header.png", "rufus-found.jpg",
  "toffee-reunion.jpg", "drone-silhouette.png",
].map((f) => `/${f}`);

const state = { me: null, pages: [], page: null, source: "original", versions: [], dirty: false, mode: "visual" };

// ============ Screens ============
function show(id) {
  $$(".screen").forEach((s) => (s.hidden = s.id !== id));
}

// ============ Auth ============
function authView(view, message, kind = "error") {
  show("screen-auth");
  for (const v of ["login", "signup", "forgot", "setpw"]) $(`#form-${v}`).hidden = v !== view;
  authMsg(message, kind);
  $(`#form-${view} input`)?.focus();
}

function authMsg(message, kind = "error") {
  const el = $("#auth-msg");
  el.hidden = !message;
  el.textContent = message || "";
  el.className = `msg is-${kind}`;
}

function authErrorText(err, context) {
  if (err instanceof MissingIdentityError) return "Sign-in isn’t switched on for this site yet. Please try again after the next deploy.";
  if (err instanceof AuthError) {
    const m = (err.message || "").toLowerCase();
    if (m.includes("not confirmed")) return "Please confirm your email first — check your inbox for the link we sent.";
    if (context === "login" && (err.status === 400 || err.status === 401)) return "That email or password isn’t right. Please try again.";
    if (context === "signup" && (err.status === 401 || err.status === 403 || m.includes("signup")))
      return "This email address isn’t on the approved list for the site editor.";
    if (m.includes("already")) return "An account with this email already exists. Try signing in or resetting your password.";
    if (err.status === 422) return "Please check the details — passwords need at least 8 characters.";
    return err.message || "Something went wrong. Please try again.";
  }
  return "Something went wrong. Please check your connection and try again.";
}

function busy(form, on) {
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = on;
  if (on) {
    btn.dataset.label = btn.textContent;
    btn.textContent = "Please wait…";
  } else if (btn.dataset.label) btn.textContent = btn.dataset.label;
}

let pendingInviteToken = null;

function bindAuth() {
  $$("[data-auth-view]").forEach((b) => b.addEventListener("click", () => authView(b.dataset.authView)));
  $$('[data-action="sign-out"]').forEach((b) =>
    b.addEventListener("click", async () => {
      if (state.dirty && !(await leaveOk())) return;
      state.dirty = false;
      await logout().catch(() => {});
      location.hash = "";
      authView("login", "You’ve been signed out.", "ok");
    }),
  );

  $("#form-login").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy(f, true);
    authMsg("");
    try {
      await login(f.email.value.trim(), f.password.value);
      f.reset();
      await enterApp();
    } catch (err) {
      authMsg(authErrorText(err, "login"));
    } finally {
      busy(f, false);
    }
  });

  $("#form-signup").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.password.value.length < 8) return authMsg("Please choose a password with at least 8 characters.");
    busy(f, true);
    authMsg("");
    try {
      const user = await signup(f.email.value.trim(), f.password.value, { full_name: f.name.value.trim() });
      f.reset();
      if (user?.confirmedAt) await enterApp();
      else authView("login", "Nearly there! We’ve emailed you a link — click it to confirm your account, then sign in.", "ok");
    } catch (err) {
      authMsg(authErrorText(err, "signup"));
    } finally {
      busy(f, false);
    }
  });

  $("#form-forgot").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    busy(f, true);
    try {
      await requestPasswordRecovery(f.email.value.trim());
      authView("login", "If that email has an account, a reset link is on its way.", "ok");
    } catch (err) {
      authMsg(authErrorText(err, "forgot"));
    } finally {
      busy(f, false);
    }
  });

  $("#form-setpw").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    if (f.password.value.length < 8) return authMsg("Please choose a password with at least 8 characters.");
    busy(f, true);
    try {
      if (pendingInviteToken) {
        await acceptInvite(pendingInviteToken, f.password.value);
        pendingInviteToken = null;
      } else {
        await updateUser({ password: f.password.value });
      }
      f.reset();
      toast("Password saved.");
      await enterApp();
    } catch (err) {
      authMsg(authErrorText(err, "setpw"));
    } finally {
      busy(f, false);
    }
  });
}

async function boot() {
  bindAuth();
  bindEditorChrome();
  bindMedia();
  try {
    const cb = await handleAuthCallback();
    if (cb) {
      history.replaceState(null, "", location.pathname);
      if (cb.type === "invite") {
        pendingInviteToken = cb.token;
        $("#setpw-title").textContent = "Welcome! Choose a password";
        return authView("setpw", "");
      }
      if (cb.type === "recovery") {
        $("#setpw-title").textContent = "Choose a new password";
        return authView("setpw", "");
      }
      if (cb.type === "confirmation") toast("Email confirmed — welcome!");
    }
  } catch (err) {
    authView("login", authErrorText(err, "callback"));
    return;
  }
  const user = await getUser();
  if (!user) return authView("login");
  await enterApp();
}

async function enterApp() {
  let me;
  try {
    me = await api("me");
  } catch {
    return authView("login", "We couldn’t reach the server. Please try again.");
  }
  if (!me.signedIn) return authView("login");
  state.me = me;
  if (!me.allowed) {
    $("#denied-email").textContent = me.email;
    return show("screen-denied");
  }
  $("#who").textContent = me.email;
  route();
}

// ============ Routing ============
window.addEventListener("hashchange", async () => {
  if (!state.me?.allowed) return;
  if (state.dirty && !location.hash.startsWith(`#/edit/${state.page?.key}`)) {
    if (!(await leaveOk())) {
      history.replaceState(null, "", `#/edit/${state.page.key}`);
      return;
    }
    state.dirty = false;
  }
  route();
});

window.addEventListener("beforeunload", (e) => {
  if (state.dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function leaveOk() {
  const r = await confirmBox({
    title: "Leave without saving?",
    text: "You have changes that haven’t been saved. If you leave now they’ll be lost.",
    okLabel: "Leave page",
    danger: true,
  });
  return r.ok;
}

function route() {
  const m = location.hash.match(/^#\/edit\/([\w-]+)/);
  if (m) openEditor(m[1]);
  else showDashboard();
}

// ============ Dashboard ============
function greet() {
  const h = new Date().getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  const raw = state.me?.name || (state.me?.email || "").split("@")[0].split(/[._-]/)[0];
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "";
  return name ? `${part}, ${name.split(" ")[0]}` : part;
}

async function showDashboard() {
  show("screen-dash");
  document.title = "Site editor · Noodle’s Canine Rescue";
  $("#greeting").textContent = greet();
  $("#today").textContent = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  try {
    const { pages } = await api("pages");
    state.pages = pages;
    $("#page-grid").innerHTML = pages.map(pageCard).join("");
  } catch (err) {
    $("#page-grid").innerHTML = `<p class="insp-empty">Couldn’t load the pages: ${esc(err.message)}</p>`;
  }
}

function statusPill(p) {
  if (p.hasUnpublishedDraft) return `<span class="pill is-draft">Unpublished draft</span>`;
  if (p.isCustomised) return `<span class="pill is-live">Live with edits</span>`;
  return `<span class="pill">Original</span>`;
}

function pageCard(p) {
  const l = p.latest;
  const what = { draft: "Draft saved", publish: "Published", revert: "Reset to original" }[l?.action] ?? "";
  const meta = l
    ? `${what} by ${esc(personName(l))} · ${esc(timeAgo(l.createdAt))}`
    : "Not edited yet — this is the original page.";
  return `
    <article class="page-card">
      <div>
        <div class="row"><h3>${esc(p.title)}</h3>${statusPill(p)}</div>
        <p class="path">${esc(p.path)}</p>
      </div>
      <p class="meta">${meta}</p>
      <div class="actions">
        <a class="btn btn-primary btn-sm" href="#/edit/${esc(p.key)}">Edit page</a>
        <a class="btn btn-ghost btn-sm" href="${esc(p.path)}" target="_blank" rel="noopener">View ↗</a>
      </div>
    </article>`;
}

// ============ Editor ============
const editor = createEditor($("#frame"), {
  onChange: () => setDirty(true),
  onSelect: (sel) => renderInspector(sel),
});

function setDirty(on) {
  state.dirty = on;
  $("#btn-undo").disabled = !editor.canUndo();
  updateStatus();
}

function updateStatus() {
  const el = $("#ed-status");
  if (state.dirty) {
    el.className = "pill is-dirty";
    el.textContent = "Unsaved changes";
  } else if (state.source === "draft") {
    el.className = "pill is-draft";
    el.textContent = "Draft — not live yet";
  } else if (state.source === "published") {
    el.className = "pill is-live";
    el.textContent = "Live";
  } else {
    el.className = "pill";
    el.textContent = "Original page";
  }
}

async function fetchOriginal(page) {
  const res = await fetch(`${page.path}${page.path.includes("?") ? "&" : "?"}cms-original=1`, { cache: "no-store" });
  if (!res.ok) throw new Error("Couldn’t load the original page.");
  return res.text();
}

async function openEditor(key) {
  if (!state.pages.length) {
    try {
      state.pages = (await api("pages")).pages;
    } catch (err) {
      toast(err.message, { error: true });
    }
  }
  const page = state.pages.find((p) => p.key === key);
  if (!page) return (location.hash = "#/");
  show("screen-editor");
  document.title = `Editing ${page.title} · Site editor`;
  state.page = page;
  state.dirty = false;
  $("#ed-title").textContent = page.title;
  $("#btn-live").href = page.path;
  $("#ed-status").className = "pill";
  $("#ed-status").textContent = "Loading…";
  state.mode = "visual";
  setMode("visual");
  showInspTab("edit");
  try {
    const data = await api(`pages/${key}`);
    state.source = data.source;
    state.versions = data.versions;
    const html = data.html ?? (await fetchOriginal(page));
    await editor.load(html);
    setDirty(false);
    renderHistory();
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function setMode(mode) {
  const prev = state.mode;
  if (prev === "html" && mode !== "html") {
    const src = $("#html-src").value;
    if (src !== $("#html-src").dataset.orig) {
      editor.load(src).then(() => setDirty(true));
    }
  }
  if (mode === "html") {
    const html = editor.getHTML();
    $("#html-src").value = html;
    $("#html-src").dataset.orig = html;
  }
  if (mode === "details") fillDetails();
  state.mode = mode;
  $$(".eb-mid .tab").forEach((t) => t.classList.toggle("is-on", t.dataset.mode === mode));
  $("#pane-visual").hidden = mode !== "visual";
  $("#pane-details").hidden = mode !== "details";
  $("#pane-html").hidden = mode !== "html";
  $("#device-toggle").hidden = mode !== "visual";
}

function currentHTML() {
  if (state.mode === "html") return $("#html-src").value;
  return editor.getHTML();
}

async function save(action) {
  const page = state.page;
  let note = null;
  if (action === "publish") {
    const r = await confirmBox({
      title: `Publish ${page.title}?`,
      text: "Your changes will appear on the live website straight away.",
      okLabel: "Publish now",
      withNote: true,
    });
    if (!r.ok) return;
    note = r.note || null;
  }
  const html = currentHTML();
  const btn = action === "publish" ? $("#btn-publish") : $("#btn-draft");
  btn.disabled = true;
  try {
    const { saved } = await api(`pages/${page.key}`, { json: { html, action, note } });
    state.versions.unshift(saved);
    state.source = action === "publish" ? "published" : "draft";
    if (state.mode === "html") {
      $("#html-src").dataset.orig = html;
      await editor.load(html);
    }
    setDirty(false);
    renderHistory();
    state.pages = [];
    toast(action === "publish" ? "Published — it’s live on the website." : "Draft saved. It isn’t live until you publish.");
  } catch (err) {
    toast(err.message, { error: true, ms: 6000 });
  } finally {
    btn.disabled = false;
  }
}

function bindEditorChrome() {
  $("#btn-back").addEventListener("click", () => (location.hash = "#/"));
  $("#btn-draft").addEventListener("click", () => save("draft"));
  $("#btn-publish").addEventListener("click", () => save("publish"));
  $("#btn-undo").addEventListener("click", () => {
    editor.undo();
    $("#btn-undo").disabled = !editor.canUndo();
  });
  $$(".eb-mid .tab").forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode)));
  $$("#device-toggle button").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#device-toggle button").forEach((x) => x.classList.toggle("is-on", x === b));
      $("#canvas").classList.toggle("is-mobile", b.dataset.device === "mobile");
    }),
  );
  $$(".insp-tabs button").forEach((b) => b.addEventListener("click", () => showInspTab(b.dataset.insp)));
  $("#html-src").addEventListener("input", () => setDirty(true));
  $("#html-src").addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const t = e.currentTarget;
      t.setRangeText("  ", t.selectionStart, t.selectionEnd, "end");
    }
  });

  const form = $("#details-form");
  form.addEventListener("input", (e) => {
    const name = e.target.name;
    if (name === "title") editor.setMeta({ title: e.target.value });
    if (name === "description") editor.setMeta({ description: e.target.value });
    updateSerp();
  });

  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s" && !$("#screen-editor").hidden) {
      e.preventDefault();
      save("draft");
    }
  });
}

function showInspTab(which) {
  $$(".insp-tabs button").forEach((b) => b.classList.toggle("is-on", b.dataset.insp === which));
  $("#insp-edit").hidden = which !== "edit";
  $("#insp-history").hidden = which !== "history";
}

// ---------- Page details ----------
function fillDetails() {
  const { title, description } = editor.getMeta();
  const f = $("#details-form");
  f.title.value = title;
  f.description.value = description;
  updateSerp();
}

function updateSerp() {
  const f = $("#details-form");
  $("#serp-url").textContent = `noodlescaninerescue.com${state.page?.path === "/" ? "" : state.page?.path ?? ""}`;
  $("#serp-title").textContent = f.title.value || "Untitled page";
  $("#serp-desc").textContent = f.description.value || "Add a short description of this page.";
  const tc = $('[data-count-for="title"]');
  tc.textContent = `${f.title.value.length} / 60 recommended`;
  tc.classList.toggle("is-long", f.title.value.length > 60);
  const dc = $('[data-count-for="description"]');
  dc.textContent = `${f.description.value.length} / 160 recommended`;
  dc.classList.toggle("is-long", f.description.value.length > 160);
}

// ---------- Inspector ----------
const LABELS = {
  P: "Paragraph", H1: "Main heading", H2: "Heading", H3: "Heading", H4: "Heading", H5: "Heading", H6: "Heading",
  LI: "List item", UL: "List", OL: "List", FIGURE: "Photo + caption", SECTION: "Section", HEADER: "Banner",
  FOOTER: "Footer", NAV: "Menu", ARTICLE: "Article", ASIDE: "Side panel", BLOCKQUOTE: "Quote", IMG: "Photo",
  A: "Link card", DIV: "Box", TABLE: "Table", TR: "Table row", DETAILS: "Expandable",
};
const blockLabel = (el) => LABELS[el.tagName] || "Block";
const snippet = (el) => (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 60);

function renderInspector(sel) {
  const box = $("#insp-edit");
  if (!sel) {
    box.innerHTML = `
      <div class="insp-empty">
        <strong>Click anything on the page to edit it.</strong>
        <ul>
          <li>Click text and type to change it.</li>
          <li>Click a photo to replace it.</li>
          <li>Select a block to duplicate, move or delete it — handy for adding a new news story.</li>
          <li>Press <kbd>Enter</kbd> for a new line. Pasted text is cleaned automatically.</li>
        </ul>
      </div>`;
    return;
  }
  const parts = [];
  const { el, target } = sel;
  const isImg = el?.tagName === "IMG";

  if (el && !isImg) {
    parts.push(`
      <section class="insp-section">
        <h4>Text</h4>
        <div class="btn-row">
          <button class="tool" data-fmt="bold" title="Bold"><b>B</b></button>
          <button class="tool" data-fmt="italic" title="Italic"><i>I</i></button>
          <button class="tool" data-fmt="link" title="Turn selected words into a link">Link</button>
          <button class="tool" data-fmt="unlink" title="Remove link">Unlink</button>
          <button class="tool" data-fmt="removeFormat" title="Clear bold/italic">Clear</button>
        </div>
        <p class="block-desc">Select words first, then choose a style.</p>
      </section>`);
  }

  const link = (target || el)?.closest?.("a") || (el && !isImg && el.querySelector?.("a") && el.querySelectorAll("a").length === 1 ? el.querySelector("a") : null);
  if (link) {
    parts.push(`
      <section class="insp-section">
        <h4>Link</h4>
        <label>Goes to<input type="text" id="link-href" value="${esc(link.getAttribute("href") || "")}" placeholder="https://… or page.html"></label>
        <label class="check"><input type="checkbox" id="link-blank" ${link.target === "_blank" ? "checked" : ""}> Open in a new tab</label>
        <p class="block-desc">Tip: use <code>tel:07624…</code> for phone numbers and <code>mailto:</code> for email.</p>
      </section>`);
  }

  if (isImg) {
    parts.push(`
      <section class="insp-section">
        <h4>Photo</h4>
        <img class="img-preview" src="${esc(el.getAttribute("src"))}" alt="">
        <div class="btn-row"><button class="btn btn-secondary btn-sm" id="img-replace">Replace photo…</button></div>
        <label>Description (for screen readers &amp; Google)
          <textarea id="img-alt" rows="3">${esc(el.getAttribute("alt") || "")}</textarea>
        </label>
      </section>`);
  }

  const bg = editor.backgroundHost(target || el);
  if (bg) {
    parts.push(`
      <section class="insp-section">
        <h4>Background photo</h4>
        <img class="img-preview" src="${esc(editor.backgroundUrl(bg))}" alt="">
        <div class="btn-row"><button class="btn btn-ghost btn-sm" id="bg-replace">Change background…</button></div>
      </section>`);
  }

  if (sel.chain.length) {
    const b = sel.chain[sel.level];
    parts.push(`
      <section class="insp-section">
        <h4>Block</h4>
        <div class="crumbs">
          ${sel.chain.map((c, i) => `<button class="crumb ${i === sel.level ? "is-on" : ""}" data-level="${i}" title="${esc(snippet(c))}">${esc(blockLabel(c))}</button>`).join("")}
        </div>
        <p class="block-desc">${snippet(b) ? `“${esc(snippet(b))}${snippet(b).length >= 60 ? "…" : ""}”` : "Selected block is outlined in purple."}</p>
        <div class="btn-row">
          <button class="tool" data-block="duplicate">Duplicate</button>
          <button class="tool" data-block="up" ${editor.siblingOf(b, -1) ? "" : "disabled"}>↑ Move up</button>
          <button class="tool" data-block="down" ${editor.siblingOf(b, 1) ? "" : "disabled"}>↓ Move down</button>
          <button class="tool danger" data-block="delete">Delete</button>
        </div>
        <p class="block-desc">Pick a bigger block above (e.g. a whole card) to copy or remove more at once.</p>
      </section>`);
  }

  box.innerHTML = parts.join("");

  // Keep the iframe's text selection when pressing toolbar buttons.
  box.querySelectorAll("[data-fmt]").forEach((b) => b.addEventListener("mousedown", (e) => e.preventDefault()));
  box.querySelectorAll("[data-fmt]").forEach((b) =>
    b.addEventListener("click", () => {
      const cmd = b.dataset.fmt;
      if (cmd === "link") {
        const url = prompt("Link to (web address, page like news.html, tel: or mailto:)", "https://");
        if (url && url !== "https://") editor.format("createLink", url);
      } else editor.format(cmd);
    }),
  );

  if (link) {
    $("#link-href").addEventListener("input", (e) => {
      link.setAttribute("href", e.target.value.trim());
      setDirty(true);
    });
    $("#link-blank").addEventListener("change", (e) => {
      if (e.target.checked) {
        link.setAttribute("target", "_blank");
        link.setAttribute("rel", "noopener");
      } else {
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
      setDirty(true);
    });
  }

  if (isImg) {
    $("#img-replace").addEventListener("click", async () => {
      const url = await pickImage();
      if (url) {
        editor.setImage(el, url);
        renderInspector(sel);
      }
    });
    $("#img-alt").addEventListener("input", (e) => {
      el.setAttribute("alt", e.target.value);
      setDirty(true);
    });
  }

  if (bg) {
    $("#bg-replace").addEventListener("click", async () => {
      const url = await pickImage();
      if (url) {
        editor.setBackground(bg, url);
        renderInspector(sel);
      }
    });
  }

  box.querySelectorAll("[data-level]").forEach((b) => b.addEventListener("click", () => editor.setLevel(Number(b.dataset.level))));
  box.querySelectorAll("[data-block]").forEach((b) =>
    b.addEventListener("click", async () => {
      const act = b.dataset.block;
      if (act === "duplicate") editor.duplicate();
      if (act === "up") editor.move(-1);
      if (act === "down") editor.move(1);
      if (act === "delete") {
        const blk = editor.currentBlock();
        const r = await confirmBox({
          title: `Delete this ${blockLabel(blk).toLowerCase()}?`,
          text: "You can bring it back with Undo, or by loading an earlier version from History.",
          okLabel: "Delete",
          danger: true,
        });
        if (r.ok) editor.remove();
      }
      $("#btn-undo").disabled = !editor.canUndo();
    }),
  );
}

// ---------- History ----------
function renderHistory() {
  const label = { draft: "Draft saved", publish: "Published", revert: "Reset to original" };
  const items = state.versions
    .map(
      (v, i) => `
      <div class="hist-item">
        <div class="top"><strong>${label[v.action] ?? v.action}</strong>${i === 0 ? `<span class="pill">Latest</span>` : ""}</div>
        <span class="who">${esc(personName(v))}</span>
        <span class="when" title="${esc(formatWhen(v.createdAt))}">${esc(formatWhen(v.createdAt))}</span>
        ${v.note && v.action !== "revert" ? `<span class="note">“${esc(v.note)}”</span>` : ""}
        ${v.action !== "revert" ? `<div class="btn-row"><button class="tool" data-load="${v.id}">Open this version</button></div>` : ""}
      </div>`,
    )
    .join("");
  $("#insp-history").innerHTML = `
    <section class="insp-section">
      <h4>Original page</h4>
      <p class="block-desc">The page as it was originally built.</p>
      <div class="btn-row">
        <button class="tool" id="load-original">Open original</button>
        <button class="tool danger" id="reset-original" ${state.versions.length ? "" : "disabled"}>Put original back live</button>
      </div>
    </section>
    <section class="insp-section">
      <h4>Saved versions</h4>
      <div class="history">${items || `<p class="insp-empty">No saved versions yet. Use <em>Save draft</em> or <em>Publish</em> and they’ll appear here.</p>`}</div>
    </section>`;

  $("#load-original").addEventListener("click", async () => {
    if (state.dirty && !(await leaveOk())) return;
    await editor.load(await fetchOriginal(state.page));
    setDirty(true);
    showInspTab("edit");
    toast("Original page loaded. Publish to make it live again.");
  });
  $("#reset-original").addEventListener("click", async () => {
    const r = await confirmBox({
      title: "Put the original page back?",
      text: "The live page will go back to how it was originally built. Your edited versions stay in History.",
      okLabel: "Reset page",
      danger: true,
    });
    if (!r.ok) return;
    try {
      const { saved } = await api(`pages/${state.page.key}/revert`, { method: "POST", json: {} });
      state.versions.unshift(saved);
      state.source = "original";
      state.pages = [];
      await editor.load(await fetchOriginal(state.page));
      setDirty(false);
      renderHistory();
      toast("The original page is live again.");
    } catch (err) {
      toast(err.message, { error: true });
    }
  });
  $$("[data-load]", $("#insp-history")).forEach((b) =>
    b.addEventListener("click", async () => {
      if (state.dirty && !(await leaveOk())) return;
      try {
        const v = await api(`versions/${b.dataset.load}`);
        await editor.load(v.html);
        setDirty(true);
        showInspTab("edit");
        toast(`Opened the version from ${formatWhen(v.createdAt)}. Publish to make it live.`, { ms: 5000 });
      } catch (err) {
        toast(err.message, { error: true });
      }
    }),
  );
}

// ============ Image picker ============
let pickResolve = null;

function pickImage() {
  const dlg = $("#media-dialog");
  $("#upload-status").hidden = true;
  $("#media-site").innerHTML = SITE_IMAGES.map(thumb).join("");
  $("#media-uploaded").innerHTML = `<p class="media-empty">Loading…</p>`;
  api("media")
    .then(({ items }) => {
      $("#media-uploaded").innerHTML = items.length
        ? items.map((i) => thumb(i.url)).join("")
        : `<p class="media-empty">Nothing uploaded yet.</p>`;
    })
    .catch(() => ($("#media-uploaded").innerHTML = `<p class="media-empty">Couldn’t load uploaded photos.</p>`));
  dlg.returnValue = "";
  dlg.showModal();
  return new Promise((resolve) => {
    pickResolve = resolve;
    dlg.addEventListener(
      "close",
      () => {
        if (pickResolve) pickResolve(null);
        pickResolve = null;
      },
      { once: true },
    );
  });
}

function thumb(url) {
  return `<button type="button" data-pick="${esc(url)}" title="${esc(url.split("/").pop())}"><img src="${esc(url)}" alt="" loading="lazy"></button>`;
}

function choose(url) {
  const r = pickResolve;
  pickResolve = null;
  $("#media-dialog").close();
  r?.(url);
}

// Large phone photos are scaled down before upload so pages stay fast.
async function shrink(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const max = 2000;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 1_500_000) return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const type = file.type === "image/png" ? "image/png" : "image/jpeg";
  const blob = await new Promise((r) => canvas.toBlob(r, type, 0.85));
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], file.name.replace(/\.\w+$/, type === "image/png" ? ".png" : ".jpg"), { type });
}

async function upload(file) {
  const status = $("#upload-status");
  status.hidden = false;
  status.textContent = "Uploading…";
  try {
    const small = await shrink(file);
    const body = new FormData();
    body.append("file", small);
    const { url } = await api("upload", { body });
    status.textContent = "Uploaded!";
    choose(url);
  } catch (err) {
    status.textContent = err.message;
  }
}

function bindMedia() {
  const dlg = $("#media-dialog");
  dlg.addEventListener("click", (e) => {
    const b = e.target.closest("[data-pick]");
    if (b) {
      e.preventDefault();
      choose(b.dataset.pick);
    }
  });
  $("#upload-btn").addEventListener("click", () => $("#upload-input").click());
  $("#upload-input").addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (f) upload(f);
  });
  const zone = $("#upload-zone");
  zone.addEventListener("dragover", (e) => {
    e.preventDefault();
    zone.classList.add("is-over");
  });
  zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
  zone.addEventListener("drop", (e) => {
    e.preventDefault();
    zone.classList.remove("is-over");
    const f = e.dataTransfer?.files?.[0];
    if (f) upload(f);
  });
}

renderInspector(null);
boot();
