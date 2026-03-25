alter table tutor_progress
  add column if not exists theme_round_in_section integer not null default 1;

alter table tutor_progress
  add column if not exists completed_theme_keys jsonb not null default '[]'::jsonb;
