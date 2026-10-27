import { notFound, redirect } from "next/navigation";
import { CloudReader } from "@/components/reader/CloudReader";
import { PDF_BUCKET, supabaseConfigured, type DocumentRow } from "@/lib/supabase/config";
import { supabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// Long enough for a long listening session; PDF.js keeps range-requesting the file.
const SIGNED_URL_SECONDS = 60 * 60 * 12;

export default async function ReadPage({ params }: { params: Promise<{ id: string }> }) {
  if (!supabaseConfigured) redirect("/read/local");
  const { id } = await params;
  const supabase = await supabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect(`/login?next=/read/${id}`);

  const { data: doc } = await supabase.from("documents").select("*").eq("id", id).maybeSingle();
  if (!doc) notFound();

  const { data: signed, error } = await supabase.storage
    .from(PDF_BUCKET)
    .createSignedUrl((doc as DocumentRow).storage_path, SIGNED_URL_SECONDS);
  if (error || !signed) throw new Error(`Could not open file: ${error?.message ?? "unknown error"}`);

  return <CloudReader doc={doc as DocumentRow} url={signed.signedUrl} />;
}
