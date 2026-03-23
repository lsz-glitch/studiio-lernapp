-- Materialien "löschen", ohne Kontextdaten zu verlieren:
-- Statt row delete wird nur deleted_at gesetzt.

alter table if exists materials
  add column if not exists deleted_at timestamptz;

create index if not exists idx_materials_user_subject_not_deleted
  on materials (user_id, subject_id, created_at desc)
  where deleted_at is null;
