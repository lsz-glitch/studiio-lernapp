-- Timetracking: Lernzeit pro Fach (Phase 3, Schritt 14)
-- Einmalig im Supabase SQL Editor ausführen.

create table if not exists user_learning_time (
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  total_seconds bigint default 0,
  updated_at timestamptz default now(),
  primary key (user_id, subject_id)
);

comment on table user_learning_time is 'Gesamte Lernzeit pro Nutzer und Fach (Tutor + Vokabeln)';

create index if not exists user_learning_time_user on user_learning_time(user_id);

alter table user_learning_time enable row level security;

drop policy if exists "user_learning_time_select_own" on user_learning_time;
create policy "user_learning_time_select_own"
  on user_learning_time for select
  using (auth.uid() = user_id);

drop policy if exists "user_learning_time_insert_own" on user_learning_time;
create policy "user_learning_time_insert_own"
  on user_learning_time for insert
  with check (auth.uid() = user_id);

drop policy if exists "user_learning_time_update_own" on user_learning_time;
create policy "user_learning_time_update_own"
  on user_learning_time for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
