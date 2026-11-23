/** Only allow same-site relative paths (blocks open redirects like //evil.com or https://…). */
export function safeNextPath(next: string | null | undefined, fallback = "/"): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}

/** Pages that must work while signed out. */
export const PUBLIC_PATHS = ["/login", "/forgot-password", "/reset-password", "/auth"];
export const isPublicPath = (path: string) => PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
