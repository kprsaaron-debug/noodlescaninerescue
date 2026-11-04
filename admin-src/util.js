// Small shared helpers for the admin dashboard.
import { getUser } from "@netlify/identity";

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export async function api(path, opts = {}) {
  const init = { credentials: "same-origin", method: opts.method ?? (opts.json || opts.body ? "POST" : "GET"), headers: {} };
  if (opts.json !== undefined) {
    init.headers["content-type"] = "application/json";
    init.body = JSON.stringify(opts.json);
  } else if (opts.body) {
    init.body = opts.body;
  }
  let res = await fetch(`/api/admin/${path}`, init);
  if (res.status === 401) {
    // The access token may have just expired — refresh it and try once more.
    await getUser();
    res = await fetch(`/api/admin/${path}`, init);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Something went wrong (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

let toastTimer;
export function toast(message, { error = false, ms = 3200 } = {}) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("is-error", error);
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), ms);
}

// Promise-based confirm dialog. Resolves { ok, note }.
export function confirmBox({ title, text, okLabel = "OK", danger = false, withNote = false }) {
  const dlg = $("#confirm-dialog");
  $("#confirm-title").textContent = title;
  $("#confirm-text").textContent = text;
  const ok = $("#confirm-ok");
  ok.textContent = okLabel;
  ok.className = `btn ${danger ? "btn-danger" : "btn-primary"}`;
  $("#confirm-note-wrap").hidden = !withNote;
  $("#confirm-note").value = "";
  dlg.returnValue = "";
  dlg.showModal();
  if (withNote) $("#confirm-note").focus();
  $("#confirm-note").onkeydown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      dlg.close("ok");
    }
  };
  return new Promise((resolve) => {
    dlg.addEventListener(
      "close",
      () => resolve({ ok: dlg.returnValue === "ok", note: $("#confirm-note").value.trim() }),
      { once: true },
    );
  });
}

const rtf = new Intl.RelativeTimeFormat("en-GB", { numeric: "auto" });
export function timeAgo(iso) {
  const d = new Date(iso);
  const secs = (d.getTime() - Date.now()) / 1000;
  const abs = Math.abs(secs);
  if (abs < 60) return "just now";
  if (abs < 3600) return rtf.format(Math.round(secs / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(secs / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(secs / 86400), "day");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function formatWhen(iso) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const personName = (v) => v?.authorName || (v?.authorEmail ? v.authorEmail.split("@")[0] : "Someone");
