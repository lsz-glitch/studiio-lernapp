-- Eigener Name für manuellen Vokabel-Unterordner pro Fach
-- Einmalig im Supabase SQL Editor ausführen.

alter table subjects
  add column if not exists flashcards_manual_folder_name text;

comment on column subjects.flashcards_manual_folder_name is
  'Individueller Name des manuellen Vokabel-Unterordners pro Fach';
