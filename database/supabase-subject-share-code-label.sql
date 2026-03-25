-- Optionaler Name/Label pro Share-Code
-- Einmalig im Supabase SQL Editor ausführen.

alter table subject_share_exports
  add column if not exists code_label text;
