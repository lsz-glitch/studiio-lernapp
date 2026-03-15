-- Lernplan: Tasks mit Datum/Uhrzeit (Phase 3, Schritt 15)
-- Einmalig im Supabase SQL Editor ausführen.

create table if not exists learning_plan_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null check (type in ('tutor','vocab','exam','manual')),
  subject_id uuid references subjects(id) on delete cascade,
  material_id uuid references materials(id) on delete set null,
  title text not null,
  scheduled_at timestamptz not null,
  completed_at timestamptz default null,
  position int default 0,
  created_at timestamptz default now()
);

comment on table learning_plan_tasks is 'Lernplan: Tutor, Vokabeln, Klausur, manuelle Tasks mit Datum/Uhrzeit';

create index if not exists learning_plan_tasks_user on learning_plan_tasks(user_id);
create index if not exists learning_plan_tasks_scheduled on learning_plan_tasks(scheduled_at);
create index if not exists learning_plan_tasks_user_scheduled on learning_plan_tasks(user_id, scheduled_at);

alter table learning_plan_tasks enable row level security;

drop policy if exists "learning_plan_tasks_select_own" on learning_plan_tasks;
create policy "learning_plan_tasks_select_own"
  on learning_plan_tasks for select
  using (auth.uid() = user_id);

drop policy if exists "learning_plan_tasks_insert_own" on learning_plan_tasks;
create policy "learning_plan_tasks_insert_own"
  on learning_plan_tasks for insert
  with check (auth.uid() = user_id);

drop policy if exists "learning_plan_tasks_update_own" on learning_plan_tasks;
create policy "learning_plan_tasks_update_own"
  on learning_plan_tasks for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "learning_plan_tasks_delete_own" on learning_plan_tasks;
create policy "learning_plan_tasks_delete_own"
  on learning_plan_tasks for delete
  using (auth.uid() = user_id);
