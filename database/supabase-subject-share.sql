-- Fächer teilen per Import-Code (MVP)
-- Einmalig im Supabase SQL Editor ausführen.

create table if not exists subject_share_exports (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  source_subject_id uuid not null references subjects(id) on delete cascade,
  share_code text not null unique,
  code_label text default null,
  include_subject boolean not null default true,
  include_notes boolean not null default true,
  include_materials boolean not null default true,
  include_flashcards boolean not null default true,
  is_active boolean not null default true,
  expires_at timestamptz not null default (now() + interval '14 days'),
  import_count int not null default 0,
  created_at timestamptz default now(),
  last_used_at timestamptz default null
);

create index if not exists subject_share_exports_owner on subject_share_exports(owner_user_id);
create index if not exists subject_share_exports_code on subject_share_exports(share_code);

create table if not exists subject_share_imports (
  id uuid primary key default gen_random_uuid(),
  export_id uuid not null references subject_share_exports(id) on delete cascade,
  importer_user_id uuid not null references auth.users(id) on delete cascade,
  new_subject_id uuid not null references subjects(id) on delete cascade,
  imported_at timestamptz default now()
);

create index if not exists subject_share_imports_export on subject_share_imports(export_id);
create index if not exists subject_share_imports_importer on subject_share_imports(importer_user_id);

alter table subject_share_exports enable row level security;
alter table subject_share_imports enable row level security;

drop policy if exists "subject_share_exports_select_own" on subject_share_exports;
create policy "subject_share_exports_select_own"
  on subject_share_exports for select
  using (auth.uid() = owner_user_id);

drop policy if exists "subject_share_exports_insert_own" on subject_share_exports;
create policy "subject_share_exports_insert_own"
  on subject_share_exports for insert
  with check (auth.uid() = owner_user_id);

drop policy if exists "subject_share_exports_update_own" on subject_share_exports;
create policy "subject_share_exports_update_own"
  on subject_share_exports for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

drop policy if exists "subject_share_imports_select_own" on subject_share_imports;
create policy "subject_share_imports_select_own"
  on subject_share_imports for select
  using (auth.uid() = importer_user_id);

drop policy if exists "subject_share_imports_insert_own" on subject_share_imports;
create policy "subject_share_imports_insert_own"
  on subject_share_imports for insert
  with check (auth.uid() = importer_user_id);
