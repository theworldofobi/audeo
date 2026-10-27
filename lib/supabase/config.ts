export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** False until the user fills in the Supabase env vars (see docs/API_SETUP.md). */
export const supabaseConfigured = Boolean(
  SUPABASE_URL && SUPABASE_ANON_KEY && !SUPABASE_URL.includes("YOUR-PROJECT-REF"),
);

export const PDF_BUCKET = "pdfs";
export const AUDIO_BUCKET = "audio";

export interface DocumentRow {
  id: string;
  user_id: string;
  title: string;
  storage_path: string;
  size_bytes: number;
  page_count: number | null;
  last_page: number;
  last_offset: number;
  voice: string | null;
  rate: number;
  created_at: string;
  updated_at: string;
}
