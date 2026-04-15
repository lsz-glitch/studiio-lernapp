-- Daily Lernzeit pro Fach (für Statistik-Fachfilter)
-- Einmalig im Supabase SQL Editor ausführen.

create table if not exists user_daily_subject_learning_seconds (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  day date not null,
  total_seconds bigint default 0,
  updated_at timestamptz default now(),
  primary key (user_id, subject_id, day)
);

comment on table user_daily_subject_learning_seconds is 'Tägliche Lernzeit pro Nutzer und Fach';

create index if not exists idx_user_daily_subject_learning_seconds_user
  on user_daily_subject_learning_seconds(user_id);

create index if not exists idx_user_daily_subject_learning_seconds_subject
  on user_daily_subject_learning_seconds(user_id, subject_id);

alter table user_daily_subject_learning_seconds enable row level security;

drop policy if exists "user_daily_subject_learning_seconds_select_own" on user_daily_subject_learning_seconds;
create policy "user_daily_subject_learning_seconds_select_own"
  on user_daily_subject_learning_seconds
  for select
  using (auth.uid() = user_id);

drop policy if exists "user_daily_subject_learning_seconds_insert_own" on user_daily_subject_learning_seconds;
create policy "user_daily_subject_learning_seconds_insert_own"
  on user_daily_subject_learning_seconds
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_daily_subject_learning_seconds_update_own" on user_daily_subject_learning_seconds;
create policy "user_daily_subject_learning_seconds_update_own"
  on user_daily_subject_learning_seconds
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
