import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseConfigured } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

export default async function Home() {
  if (supabaseConfigured) {
    const { data } = await (await supabaseServer()).auth.getUser();
    if (data.user) redirect("/library");
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-3xl flex-col justify-center px-6 py-16">
      <p className="text-4xl font-black tracking-tight text-violet-700">audeo</p>
      <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
        Listen to any PDF — even the giant ones.
      </h1>
      <p className="mt-4 max-w-xl text-lg text-neutral-600">
        Natural voices at up to 3× speed. Follow along on the original document with the sentence highlighted and
        each word lit up as it&apos;s spoken.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        {supabaseConfigured && (
          <Link href="/login" className="rounded-full bg-violet-600 px-6 py-3 font-semibold text-white hover:bg-violet-700">
            Sign in
          </Link>
        )}
        <Link
          href="/read/local"
          className="rounded-full border border-neutral-300 bg-white px-6 py-3 font-semibold hover:bg-neutral-50"
        >
          Open a PDF from this device
        </Link>
      </div>
      {!supabaseConfigured && (
        <p className="mt-10 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Accounts and your cloud library are off until Supabase is configured. See <code>docs/API_SETUP.md</code>.
        </p>
      )}
    </main>
  );
}
