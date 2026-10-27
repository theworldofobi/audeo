import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next") ?? "/library";
  const next = nextParam.startsWith("/") && !nextParam.startsWith("//") ? nextParam : "/library";

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  const login = new URL("/login", url.origin);
  login.searchParams.set("error", "That sign-in link is invalid or has expired.");
  return NextResponse.redirect(login);
}
