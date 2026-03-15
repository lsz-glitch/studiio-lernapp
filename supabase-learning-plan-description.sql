-- Lernplan: Beschreibung pro Task (optional)
-- Einmalig im Supabase SQL Editor ausführen.

alter table learning_plan_tasks
  add column if not exists description text;

comment on column learning_plan_tasks.description is 'Optionale Beschreibung oder Notiz zum Task';
