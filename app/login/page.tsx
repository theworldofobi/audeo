"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/library";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(params.get("error"));
  const [busy, setBusy] = useState(false);

  const redirectTo = () => {
    const origin = process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
    return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
  };

  const sendLink = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabaseBrowser().auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirectTo() },
    });
    setBusy(false);
    if (error) setError(error.message);
    else setSent(true);
  };

  const google = async () => {
    const { error } = await supabaseBrowser().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirectTo() },
    });
    if (error) setError(error.message);
  };

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6">
      <p className="text-3xl font-black tracking-tight text-violet-700">audeo</p>
      <h1 className="mt-4 text-2xl font-bold">Sign in</h1>
      {sent ? (
        <p className="mt-6 rounded-lg bg-green-50 p-4 text-green-800">
          Check <strong>{email}</strong> for a sign-in link.
        </p>
      ) : (
        <>
          <form onSubmit={sendLink} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-lg border border-neutral-300 px-4 py-3"
            />
            <button
              disabled={busy}
              className="w-full rounded-lg bg-violet-600 py-3 font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {busy ? "Sending…" : "Email me a sign-in link"}
            </button>
          </form>
          <div className="my-6 flex items-center gap-3 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200" />
            or
            <span className="h-px flex-1 bg-neutral-200" />
          </div>
          <button
            type="button"
            onClick={google}
            className="w-full rounded-lg border border-neutral-300 bg-white py-3 font-semibold hover:bg-neutral-50"
          >
            Continue with Google
          </button>
        </>
      )}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
    </main>
  );
}
