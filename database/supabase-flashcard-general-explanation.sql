-- Allgemeine Erklärung pro Karte (geräteübergreifend)
-- Einmalig im Supabase SQL Editor ausführen.

alter table flashcards
  add column if not exists general_explanation text;

comment on column flashcards.general_explanation is 'Allgemeine, vom Nutzer bearbeitbare Erklärung pro Karte (für Geräte-Sync)';
