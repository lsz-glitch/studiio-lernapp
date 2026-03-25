-- Share-Code Ablauf nach 14 Tagen
-- Einmalig im Supabase SQL Editor ausführen (für bestehende Installationen).

alter table subject_share_exports
  add column if not exists expires_at timestamptz;

update subject_share_exports
set expires_at = coalesce(expires_at, created_at + interval '14 days', now() + interval '14 days');

alter table subject_share_exports
  alter column expires_at set not null;
