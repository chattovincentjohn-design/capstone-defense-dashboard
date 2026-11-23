import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/redirect";

/**
 * Landing point for links in Supabase emails. Supports both link styles:
 *  - token_hash + type (recommended email template; works on any device)
 *  - code (Supabase's default template with PKCE; works in the browser that asked)
 * On success the session cookie is set and the user continues to `next`.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"), "/reset-password");
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type) {
    ok = !(await supabase.auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } else if (code) {
    ok = !(await supabase.auth.exchangeCodeForSession(code)).error;
  }

  const dest = new URL(ok ? next : "/reset-password?error=invalid_link", url.origin);
  return NextResponse.redirect(dest);
}
