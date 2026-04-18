-- Optionale Weiterleitung für Lernplan-Aufgaben (https/http), z. B. Moodle oder Übungsseite.
-- Einmalig im Supabase SQL Editor ausführen.

alter table learning_plan_tasks
  add column if not exists external_url text;

comment on column learning_plan_tasks.external_url is 'Optional: http(s)-URL — beim Start aus dem Plan in neuem Tab öffnen';
