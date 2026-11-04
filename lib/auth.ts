import { getUser, type User } from "@netlify/identity";

// Who may use the dashboard: anyone whose email is listed in the ADMIN_EMAILS
// environment variable (comma separated), or any Identity user given the
// "admin" or "editor" role in the Netlify UI.
export const allowedEmails = (): string[] =>
  (process.env.ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e: string) => e.trim().toLowerCase())
    .filter(Boolean);

export const isEmailAllowed = (email?: string | null) =>
  !!email && allowedEmails().includes(email.toLowerCase());

export const isEditor = (user: User | null): user is User => {
  if (!user) return false;
  const roles = user.roles ?? [];
  return isEmailAllowed(user.email) || roles.includes("admin") || roles.includes("editor");
};

export const getEditor = async () => {
  const user = await getUser();
  return { user, allowed: isEditor(user) };
};

// The dashboard API authenticates with the nf_jwt cookie, so reject
// state-changing requests that come from another site.
export const isSameOrigin = (req: Request) => {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  return origin === new URL(req.url).origin;
};

export const json = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "cache-control": "no-store" } });
