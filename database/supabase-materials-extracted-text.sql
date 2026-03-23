-- Speichert extrahierten PDF-Text direkt am Material, damit Tutor/Karten schneller starten.
-- Optionales Performance-Feature: Falls nicht ausgeführt, bleibt Fallback-Extraktion aktiv.

alter table if exists materials
  add column if not exists extracted_text text;

alter table if exists materials
  add column if not exists extracted_num_pages integer;

alter table if exists materials
  add column if not exists extracted_at timestamptz;
