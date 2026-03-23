-- Persistenter Tutor-Stand pro Nutzer + Material
-- Ermöglicht Pause/Weiter über Sessions und Geräte.

create table if not exists tutor_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  material_id uuid not null references materials(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  topic_index integer not null default 1,
  num_pages integer,
  messages jsonb not null default '[]'::jsonb,
  current_task_text text,
  started boolean not null default false,
  initial_request_done boolean not null default false,
  explanation_history jsonb not null default '[]'::jsonb,
  history_index integer not null default -1,
  is_completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, material_id)
);

create index if not exists idx_tutor_progress_subject
  on tutor_progress(user_id, subject_id, is_completed);

alter table tutor_progress enable row level security;

drop policy if exists "tutor_progress_select_own" on tutor_progress;
create policy "tutor_progress_select_own"
  on tutor_progress
  for select
  using (auth.uid() = user_id);

drop policy if exists "tutor_progress_insert_own" on tutor_progress;
create policy "tutor_progress_insert_own"
  on tutor_progress
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "tutor_progress_update_own" on tutor_progress;
create policy "tutor_progress_update_own"
  on tutor_progress
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
