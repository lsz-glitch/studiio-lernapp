-- Notizfeld pro Fach und Nutzer
-- Einmalig im Supabase SQL Editor ausführen.

create table if not exists subject_notes (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  content text default '',
  updated_at timestamptz default now(),
  primary key (user_id, subject_id)
);

comment on table subject_notes is 'Freie Notizen pro Nutzer und Fach';

create index if not exists subject_notes_user on subject_notes(user_id);
create index if not exists subject_notes_subject on subject_notes(subject_id);

alter table subject_notes enable row level security;

drop policy if exists "subject_notes_select_own" on subject_notes;
create policy "subject_notes_select_own"
  on subject_notes for select
  using (auth.uid() = user_id);

drop policy if exists "subject_notes_insert_own" on subject_notes;
create policy "subject_notes_insert_own"
  on subject_notes for insert
  with check (auth.uid() = user_id);

drop policy if exists "subject_notes_update_own" on subject_notes;
create policy "subject_notes_update_own"
  on subject_notes for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
