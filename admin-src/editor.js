// Visual page editor: loads a page's HTML into an iframe, makes text and images
// editable in place, and serialises a clean copy of the HTML back out.

const EDITOR_CSS = `
  [data-cms-hover] { outline: 2px dashed rgba(198,40,40,.55) !important; outline-offset: 3px; }
  [data-cms-hover]:not(img) { cursor: text; }
  img[data-cms-hover] { cursor: pointer; }
  [data-cms-active] { outline: 2px solid #C62828 !important; outline-offset: 3px; }
  [data-cms-block] { outline: 2px solid #4A1C6B !important; outline-offset: 5px; box-shadow: 0 0 0 9999px rgba(74,28,107,.06) inset; }
  [contenteditable]:focus { outline: 2px solid #C62828 !important; outline-offset: 3px; }
  a, button { cursor: text; }
`;

const INLINE = new Set([
  "A", "SPAN", "STRONG", "EM", "B", "I", "U", "S", "BR", "SMALL", "SUP", "SUB", "MARK", "CODE", "ABBR", "TIME", "Q", "CITE", "WBR",
]);
const NEVER_EDIT = new Set(["HTML", "HEAD", "BODY", "SCRIPT", "STYLE", "IMG", "SVG", "IFRAME", "VIDEO", "INPUT", "TEXTAREA", "SELECT", "NOSCRIPT"]);
const BLOCK_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "FIGURE", "SECTION", "HEADER", "FOOTER", "NAV", "ARTICLE", "ASIDE",
  "BLOCKQUOTE", "UL", "OL", "TABLE", "TR", "IMG", "DETAILS",
]);
const TRANSIENT_ATTR = /^(data-cms-(?!keep$)|contenteditable$|data-gramm|data-gr-|data-new-gr|data-lt-)/;

export function createEditor(frame, { onChange, onSelect }) {
  let doc = null;
  let hovered = null;
  let selected = null; // { el, target, chain, level }
  let undoStack = [];
  const editables = new Set();

  // ---------- loading ----------
  function prepare(html) {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    // Mark every original script/style/link so anything injected at runtime
    // (e.g. Tailwind's generated <style>) can be told apart and dropped on save.
    parsed.querySelectorAll("script, style, link, noscript").forEach((el) => el.setAttribute("data-cms-keep", ""));
    const base = parsed.createElement("base");
    base.href = `${location.origin}/`;
    base.setAttribute("data-cms-tmp", "");
    parsed.head.prepend(base);
    const style = parsed.createElement("style");
    style.setAttribute("data-cms-tmp", "");
    style.textContent = EDITOR_CSS;
    parsed.head.append(style);
    return `<!DOCTYPE html>\n${parsed.documentElement.outerHTML}`;
  }

  function load(html) {
    return new Promise((resolve) => {
      selected = null;
      hovered = null;
      editables.clear();
      undoStack = [];
      onSelect(null);
      frame.onload = () => {
        attach(frame.contentDocument);
        resolve();
      };
      frame.srcdoc = prepare(html);
    });
  }

  function attach(d) {
    doc = d;
    const win = d.defaultView;
    try { d.execCommand("styleWithCSS", false, false); } catch { /* not supported */ }
    win.addEventListener("click", onClick, true);
    win.addEventListener("mouseover", onOver, true);
    win.addEventListener("mousedown", onDown, true);
    win.addEventListener("submit", (e) => e.preventDefault(), true);
    win.addEventListener("dragstart", (e) => e.preventDefault(), true);
    d.addEventListener("input", () => onChange("text"));
    d.addEventListener("keydown", onKey, true);
    d.addEventListener("paste", onPaste, true);
  }

  // ---------- finding what can be edited ----------
  function isInlineOnly(el) {
    for (const c of el.children) {
      if (!INLINE.has(c.tagName)) return false;
      if (c.tagName !== "BR" && !isInlineOnly(c)) return false;
    }
    return true;
  }

  function textHost(node) {
    let el = node?.nodeType === 1 ? node : node?.parentElement;
    if (!el || NEVER_EDIT.has(el.tagName.toUpperCase()) || el.closest("svg")) return null;
    if (!isInlineOnly(el)) return null;
    while (
      el.parentElement &&
      el.parentElement !== doc.body &&
      !NEVER_EDIT.has(el.parentElement.tagName) &&
      isInlineOnly(el.parentElement)
    ) {
      el = el.parentElement;
    }
    return el.textContent.trim() ? el : null;
  }

  function candidate(target) {
    if (target?.tagName === "IMG") return target;
    return textHost(target);
  }

  function isBlock(n) {
    if (BLOCK_TAGS.has(n.tagName)) return true;
    const p = n.parentElement;
    if (!p) return false;
    if (n.tagName === "DIV" || n.tagName === "A") {
      // A repeated item, such as a card in a grid of cards.
      return [...p.children].filter((c) => c.tagName === n.tagName).length >= 2;
    }
    return false;
  }

  function blockChain(el) {
    const out = [];
    for (let n = el; n && n !== doc.body && n !== doc.documentElement; n = n.parentElement) {
      if (isBlock(n)) out.push(n);
    }
    return out.slice(0, 6);
  }

  // ---------- events ----------
  function setHover(el) {
    if (hovered === el) return;
    hovered?.removeAttribute("data-cms-hover");
    hovered = el;
    el?.setAttribute("data-cms-hover", "");
  }

  function makeEditable(el) {
    for (const e of editables) {
      if (e !== el && e !== selected?.el) {
        e.removeAttribute("contenteditable");
        editables.delete(e);
      }
    }
    if (el && el.tagName !== "IMG" && !el.isContentEditable) {
      el.setAttribute("contenteditable", "true");
      editables.add(el);
    }
  }

  function onOver(e) {
    const c = candidate(e.target);
    setHover(c);
    makeEditable(c);
  }

  function onDown(e) {
    const c = candidate(e.target);
    if (c?.tagName === "IMG") e.preventDefault();
    if (c) makeEditable(c);
    select(c || null, e.target);
  }

  function onClick(e) {
    if (e.target.closest?.("a, button, label, summary")) e.preventDefault();
    e.stopImmediatePropagation();
  }

  function onKey(e) {
    if (e.key === "Enter" && e.target.isContentEditable) {
      e.preventDefault();
      doc.execCommand("insertLineBreak");
    }
  }

  function onPaste(e) {
    if (!e.target.isContentEditable && !e.target.closest?.("[contenteditable]")) return;
    e.preventDefault();
    const text = e.clipboardData?.getData("text/plain") ?? "";
    doc.execCommand("insertText", false, text);
  }

  // ---------- selection ----------
  function clearMarks() {
    doc?.querySelectorAll("[data-cms-active], [data-cms-block]").forEach((n) => {
      n.removeAttribute("data-cms-active");
      n.removeAttribute("data-cms-block");
    });
  }

  function select(el, target = el, level = 0) {
    clearMarks();
    if (!el) {
      const chain = target && target !== doc.body ? blockChain(target) : [];
      selected = chain.length ? { el: null, target, chain, level: 0 } : null;
    } else {
      selected = { el, target: target || el, chain: blockChain(el), level };
      el.setAttribute("data-cms-active", "");
    }
    if (selected?.chain.length) selected.chain[selected.level]?.setAttribute("data-cms-block", "");
    onSelect(selected);
  }

  function setLevel(i) {
    if (!selected) return;
    selected.level = i;
    doc.querySelectorAll("[data-cms-block]").forEach((n) => n.removeAttribute("data-cms-block"));
    const b = selected.chain[i];
    b?.setAttribute("data-cms-block", "");
    b?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onSelect(selected);
  }

  // ---------- undo for structural changes ----------
  function snapshot() {
    undoStack.push(doc.body.innerHTML);
    if (undoStack.length > 40) undoStack.shift();
  }

  function undo() {
    const prev = undoStack.pop();
    if (prev === undefined) return false;
    doc.body.innerHTML = prev;
    stripTransient(doc.body, true);
    editables.clear();
    hovered = null;
    selected = null;
    onSelect(null);
    onChange("undo");
    return true;
  }

  // ---------- block actions ----------
  function currentBlock() {
    return selected?.chain[selected.level] ?? null;
  }

  function duplicate() {
    const b = currentBlock();
    if (!b) return;
    snapshot();
    const copy = b.cloneNode(true);
    stripTransient(copy, true);
    b.after(copy);
    onChange("block");
    clearMarks();
    selected = { el: null, target: copy, chain: blockChain(copy), level: 0 };
    setLevel(0);
    copy.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function siblingOf(b, dir) {
    let s = dir < 0 ? b.previousElementSibling : b.nextElementSibling;
    while (s && (s.tagName === "SCRIPT" || s.tagName === "STYLE")) s = dir < 0 ? s.previousElementSibling : s.nextElementSibling;
    return s;
  }

  function move(dir) {
    const b = currentBlock();
    if (!b) return;
    const s = siblingOf(b, dir);
    if (!s) return;
    snapshot();
    if (dir < 0) s.before(b);
    else s.after(b);
    onChange("block");
    b.scrollIntoView({ block: "nearest", behavior: "smooth" });
    onSelect(selected);
  }

  function remove() {
    const b = currentBlock();
    if (!b) return;
    snapshot();
    b.remove();
    selected = null;
    onSelect(null);
    onChange("block");
  }

  // ---------- content helpers used by the inspector ----------
  function format(cmd, value) {
    const win = doc.defaultView;
    win.focus();
    doc.execCommand(cmd, false, value);
    onChange("text");
  }

  function setImage(img, url) {
    snapshot();
    img.setAttribute("src", url);
    img.removeAttribute("srcset");
    const hadSize = img.hasAttribute("width") || img.hasAttribute("height");
    if (hadSize) {
      const probe = new Image();
      probe.onload = () => {
        img.setAttribute("width", String(probe.naturalWidth));
        img.setAttribute("height", String(probe.naturalHeight));
      };
      probe.src = new URL(url, location.origin).href;
    }
    onChange("image");
  }

  function backgroundHost(from) {
    for (let n = from; n && n !== doc.documentElement; n = n.parentElement) {
      if (/url\(/i.test(n.getAttribute?.("style") || "")) return n;
    }
    return null;
  }

  function backgroundUrl(el) {
    const m = [...(el.getAttribute("style") || "").matchAll(/url\((['"]?)(.*?)\1\)/gi)];
    return m.length ? m[m.length - 1][2] : null;
  }

  function setBackground(el, url) {
    snapshot();
    const style = el.getAttribute("style") || "";
    const matches = [...style.matchAll(/url\((['"]?)(.*?)\1\)/gi)];
    const last = matches[matches.length - 1];
    if (!last) return;
    const next = style.slice(0, last.index) + `url('${url.replace(/'/g, "%27")}')` + style.slice(last.index + last[0].length);
    el.setAttribute("style", next);
    onChange("image");
  }

  function getMeta() {
    if (!doc) return { title: "", description: "" };
    return {
      title: doc.title,
      description: doc.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    };
  }

  function setMeta({ title, description }) {
    if (!doc) return;
    if (title !== undefined) {
      doc.title = title;
      doc.querySelectorAll('meta[property="og:title"], meta[name="twitter:title"]').forEach((m) => m.setAttribute("content", title));
    }
    if (description !== undefined) {
      let m = doc.querySelector('meta[name="description"]');
      if (!m) {
        m = doc.createElement("meta");
        m.setAttribute("name", "description");
        doc.head.append(m);
      }
      m.setAttribute("content", description);
      doc
        .querySelectorAll('meta[property="og:description"], meta[name="twitter:description"]')
        .forEach((n) => n.setAttribute("content", description));
    }
    onChange("meta");
  }

  // ---------- serialising ----------
  function stripTransient(root, keepKeepers = false) {
    const all = root.nodeType === 1 ? [root, ...root.querySelectorAll("*")] : [...root.querySelectorAll("*")];
    for (const el of all) {
      for (const attr of [...el.attributes]) {
        if (TRANSIENT_ATTR.test(attr.name)) el.removeAttribute(attr.name);
        else if (!keepKeepers && attr.name === "data-cms-keep") el.removeAttribute(attr.name);
      }
      if (el.tagName.toLowerCase().startsWith("grammarly")) el.remove();
    }
  }

  function getHTML() {
    const clone = doc.documentElement.cloneNode(true);
    clone.querySelectorAll("[data-cms-tmp]").forEach((n) => n.remove());
    clone.querySelectorAll("script:not([data-cms-keep]), style:not([data-cms-keep]), link:not([data-cms-keep])").forEach((n) => n.remove());
    stripTransient(clone);
    return `<!DOCTYPE html>\n${clone.outerHTML}\n`;
  }

  return {
    load,
    getHTML,
    select,
    setLevel,
    duplicate,
    move,
    remove,
    undo,
    canUndo: () => undoStack.length > 0,
    format,
    setImage,
    backgroundHost,
    backgroundUrl,
    setBackground,
    getMeta,
    setMeta,
    siblingOf,
    currentBlock,
    get doc() {
      return doc;
    },
  };
}
