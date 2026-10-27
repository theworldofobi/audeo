-- audeo schema. Run once in Supabase → SQL Editor.

-- Documents ------------------------------------------------------------------
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  title         text not null,
  storage_path  text not null,
  size_bytes    bigint not null default 0,
  page_count    int,
  last_page     int not null default 1,
  last_offset   int not null default 0,
  voice         text,
  rate          real not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists documents_user_idx on public.documents (user_id, updated_at desc);

alter table public.documents enable row level security;

drop policy if exists "documents are private to their owner" on public.documents;
create policy "documents are private to their owner" on public.documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before update on public.documents
  for each row execute function public.touch_updated_at();

-- OCR results (one row per scanned page, computed once in the browser) -------
create table if not exists public.ocr_pages (
  document_id uuid not null references public.documents (id) on delete cascade,
  page        int  not null,
  text        text not null,
  words       jsonb not null,
  created_at  timestamptz not null default now(),
  primary key (document_id, page)
);

alter table public.ocr_pages enable row level security;

drop policy if exists "ocr pages follow their document" on public.ocr_pages;
create policy "ocr pages follow their document" on public.ocr_pages
  for all using (
    exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.documents d where d.id = document_id and d.user_id = auth.uid())
  );

-- Synthesized audio cache (server-only, via service role key) -----------------
create table if not exists public.audio_cache (
  hash          text primary key,
  voice         text not null,
  storage_path  text not null,
  words         jsonb not null,
  duration      real,
  chars         int not null,
  created_at    timestamptz not null default now()
);

alter table public.audio_cache enable row level security;
-- No policies: only the service role (which bypasses RLS) can read/write.

-- Storage buckets -------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('pdfs', 'pdfs', false, 1073741824, array['application/pdf'])
on conflict (id) do update set file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, allowed_mime_types)
values ('audio', 'audio', false, array['audio/mpeg', 'audio/wav'])
on conflict (id) do nothing;

-- PDFs live at pdfs/{user_id}/{document_id}.pdf; users may only touch their folder.
drop policy if exists "pdfs: owner read" on storage.objects;
create policy "pdfs: owner read" on storage.objects for select
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "pdfs: owner insert" on storage.objects;
create policy "pdfs: owner insert" on storage.objects for insert
  with check (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "pdfs: owner update" on storage.objects;
create policy "pdfs: owner update" on storage.objects for update
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "pdfs: owner delete" on storage.objects;
create policy "pdfs: owner delete" on storage.objects for delete
  using (bucket_id = 'pdfs' and (storage.foldername(name))[1] = auth.uid()::text);

-- The audio bucket has no policies: only the server (service role) uses it.
