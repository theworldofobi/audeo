import { redirect } from "next/navigation";
import { Library } from "@/components/library/Library";
import { supabaseConfigured, type DocumentRow } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  if (!supabaseConfigured) redirect("/read/local");
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect("/login");

  const { data, error } = await supabase
    .from("documents")
    .select("*")
    .order("updated_at", { ascending: false });

  return (
    <Library
      userId={auth.user.id}
      email={auth.user.email ?? ""}
      initialDocs={(data as DocumentRow[] | null) ?? []}
      loadError={error?.message ?? null}
    />
  );
}
