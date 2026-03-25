-- Entwurfsmodus für Karteikarten
-- Einmalig im Supabase SQL Editor ausführen.

alter table flashcards
  add column if not exists is_draft boolean not null default false;

create index if not exists flashcards_user_subject_draft
  on flashcards (user_id, subject_id, is_draft);
