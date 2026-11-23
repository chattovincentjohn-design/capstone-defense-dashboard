import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Role-based routing. In demo mode (no Supabase env vars) everything is public and
 * the in-app role switcher simulates identities.
 */
const ROLE_ROUTES: { prefix: string; roles: string[] }[] = [
  { prefix: "/admin", roles: ["superadmin", "admin"] },
  { prefix: "/defense", roles: ["superadmin", "admin", "chair", "panelist", "secretary", "adviser", "student"] },
  { prefix: "/account", roles: ["superadmin", "admin", "chair", "panelist", "secretary", "adviser", "student"] },
  { prefix: "/print", roles: ["superadmin", "admin", "chair", "panelist", "secretary", "adviser"] },
];

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return NextResponse.next();

  let res = NextResponse.next({ request: req });
  const sb = createServerClient(url, key, {
    cookies: {
      getAll: () => req.cookies.getAll(),
      setAll: (toSet) => {
        toSet.forEach(({ name, value }) => req.cookies.set(name, value));
        res = NextResponse.next({ request: req });
        toSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options));
      },
    },
  });

  const { data: { user } } = await sb.auth.getUser();
  const path = req.nextUrl.pathname;
  const rule = ROLE_ROUTES.find((r) => path.startsWith(r.prefix));
  if (!rule) return res;

  if (!user) {
    const login = req.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", path);
    return NextResponse.redirect(login);
  }

  const { data: profile } = await sb.from("users").select("role").eq("id", user.id).single();
  if (!profile || !rule.roles.includes(profile.role)) {
    return NextResponse.redirect(new URL("/?denied=1", req.url));
  }
  // Fine-grained per-session access (is this user on this panel?) is enforced by RLS.
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|sample-manuscript.pdf).*)"],
};
