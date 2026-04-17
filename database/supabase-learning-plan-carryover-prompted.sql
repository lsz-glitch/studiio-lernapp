-- Pro Aufgabe nur einmal nach Verschieben fragen (Tages-Begruessung / Carryover-Dialog)
-- Einmalig im Supabase SQL Editor ausfuehren.

alter table learning_plan_tasks
  add column if not exists carryover_prompted_at timestamptz;

comment on column learning_plan_tasks.carryover_prompted_at is
  'Zeitpunkt, wann diese Aufgabe bereits im taeglichen Verschiebe-Dialog abgefragt wurde';
