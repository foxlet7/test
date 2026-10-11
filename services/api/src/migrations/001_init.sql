-- Good Deeds Companion — initial schema
-- Boundaries: private records (activity_logs.note, evidence_*), scoring ledger (append-only),
-- and a minimal public projection (v_public_scores).

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  password_hash text not null,
  invite_code text,
  status text not null default 'active' check (status in ('active','suspended')),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create unique index users_email_uq on users (lower(email));

create table user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role text not null check (role in ('super_admin','content_admin','islamic_reviewer','christian_reviewer','translation_reviewer','verification_reviewer','moderator','auditor')),
  primary key (user_id, role)
);

create table invites (
  code text primary key,
  max_uses int not null default 1 check (max_uses > 0),
  uses int not null default 0,
  active boolean not null default true,
  stage int not null default 1,
  note text,
  created_at timestamptz not null default now()
);

create table profiles (
  user_id uuid primary key references users(id) on delete cascade,
  pseudonym text not null,
  ui_language text not null default 'en' check (ui_language in ('en','ar')),
  tradition text check (tradition in ('islam','christianity')),
  adult_confirmed_at timestamptz not null,
  weekly_goal int not null default 5 check (weekly_goal between 1 and 100)
);
create unique index profiles_pseudonym_uq on profiles (lower(pseudonym));

create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create table password_resets (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz
);

create table consents (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  type text not null check (type in ('account','evidence','ai_processing','leaderboard_A','leaderboard_B')),
  version text not null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index consents_active_uq on consents (user_id, type) where revoked_at is null;

-- Catalogue (data, not code) ------------------------------------------------
create table activity_definitions (
  id text primary key,
  tradition text not null check (tradition in ('islam','christianity')),
  category text not null check (category in ('worship','learning','charity','character','service')),
  type text not null check (type in ('recurring','milestone','event','measurable')),
  obligation_class text not null check (obligation_class in ('obligatory','voluntary','general_good_deed')),
  verification_class text not null default 'A' check (verification_class in ('A','B','C')),
  privacy_class text not null default 'private',
  created_at timestamptz not null default now()
);

create table activity_versions (
  id bigserial primary key,
  activity_id text not null references activity_definitions(id) on delete cascade,
  version int not null,
  base_points int not null check (base_points >= 0 and base_points <= 100),
  repeat_policy jsonb not null,
  title_en text not null,
  title_ar text not null,
  description_en text not null,
  description_ar text not null,
  notes_en text,
  notes_ar text,
  religious_references jsonb not null default '[]',
  translation_status text not null default 'machine_draft' check (translation_status in ('machine_draft','reviewed')),
  status text not null default 'draft' check (status in ('draft','in_review','approved','retired')),
  authored_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (activity_id, version)
);

create or replace function guard_approved_version() returns trigger as $$
begin
  if old.status = 'approved' then
    if new.status not in ('approved','retired') then
      raise exception 'approved activity versions cannot return to draft';
    end if;
    if (old.base_points, old.repeat_policy, old.title_en, old.title_ar, old.description_en, old.description_ar,
        old.notes_en, old.notes_ar, old.religious_references)
       is distinct from
       (new.base_points, new.repeat_policy, new.title_en, new.title_ar, new.description_en, new.description_ar,
        new.notes_en, new.notes_ar, new.religious_references) then
      raise exception 'approved activity versions are immutable; create a new version';
    end if;
  end if;
  return new;
end $$ language plpgsql;
create trigger activity_versions_guard before update on activity_versions
  for each row execute function guard_approved_version();

create table review_records (
  id bigserial primary key,
  activity_version_id bigint not null references activity_versions(id) on delete cascade,
  reviewer_id uuid,
  reviewer_role text not null,
  decision text not null check (decision in ('approve','request_changes','comment')),
  notes text,
  created_at timestamptz not null default now()
);

create table scoring_rule_versions (
  version int primary key,
  config jsonb not null,
  effective_from date not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Scripture verification tasks (content set by reviewers, never hard-coded) -------
create table scripture_tasks (
  id text primary key,
  activity_id text not null references activity_definitions(id) on delete cascade,
  tradition text not null check (tradition in ('islam','christianity')),
  title_en text not null,
  title_ar text not null,
  passage_ref text,
  reference_edition text,
  permitted_variations text,
  rubric jsonb not null default '[]',
  status text not null default 'draft' check (status in ('draft','in_review','approved','retired')),
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

-- Activity logs and the append-only ledger --------------------------------------
create table activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  activity_id text not null references activity_definitions(id),
  activity_version_id bigint not null references activity_versions(id),
  rule_version int not null references scoring_rule_versions(version),
  local_date date not null,
  tz text not null default 'UTC',
  note text,
  milestone_key text,
  status text not null default 'self_reported' check (status in ('self_reported','pending_review','verified','unable_to_verify','rejected','under_investigation')),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  unique (user_id, idempotency_key)
);
create index activity_logs_user_date on activity_logs (user_id, local_date);
create unique index activity_logs_milestone_uq on activity_logs (user_id, activity_id, milestone_key)
  where milestone_key is not null and status <> 'rejected';

create table ledger_entries (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  log_id uuid references activity_logs(id) on delete cascade,
  kind text not null check (kind in ('award','verification','reversal','adjustment')),
  eligible_points int not null default 0,
  verified_points int not null default 0,
  rule_version int,
  activity_version_id bigint,
  activity_id text,
  tradition text,
  category text,
  effective_date date not null,
  reason text,
  actor uuid,
  idempotency_key text unique,
  created_at timestamptz not null default now()
);
create index ledger_user_date on ledger_entries (user_id, effective_date);
create index ledger_log on ledger_entries (log_id);

-- Append-only: no updates ever; deletes only inside an explicit account-erasure transaction.
create or replace function ledger_guard() returns trigger as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'ledger_entries is append-only';
  end if;
  if tg_op = 'DELETE' and coalesce(current_setting('app.purge_user', true), '') <> 'on' then
    raise exception 'ledger_entries is append-only';
  end if;
  return old;
end $$ language plpgsql;
create trigger ledger_entries_guard before update or delete on ledger_entries
  for each row execute function ledger_guard();

create table adjustment_requests (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  log_id uuid,
  eligible_points int not null default 0,
  verified_points int not null default 0,
  effective_date date not null,
  reason text not null,
  requested_by uuid not null,
  approved_by uuid,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

-- Evidence and verification ----------------------------------------------------
create table evidence_objects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  kind text not null check (kind in ('audio','receipt','confirmation')),
  storage_key text,
  sha256 text not null,
  bytes int not null,
  mime text,
  retention_expires_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
create index evidence_sha on evidence_objects (sha256);

create table verification_submissions (
  id uuid primary key default gen_random_uuid(),
  log_id uuid not null references activity_logs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  task_id text not null references scripture_tasks(id),
  evidence_id uuid references evidence_objects(id) on delete set null,
  status text not null default 'pending_review' check (status in ('pending_review','verified','unable_to_verify','rejected','under_investigation')),
  risk_flags jsonb not null default '[]',
  ai_result jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index submissions_log_open on verification_submissions (log_id) where status in ('pending_review','under_investigation');

create table review_tasks (
  id bigserial primary key,
  submission_id uuid not null references verification_submissions(id) on delete cascade,
  kind text not null default 'initial' check (kind in ('initial','appeal')),
  status text not null default 'open' check (status in ('open','claimed','done')),
  claimed_by uuid,
  excluded_reviewer uuid,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table review_decisions (
  id bigserial primary key,
  task_id bigint not null references review_tasks(id) on delete cascade,
  reviewer_id uuid,
  decision text not null check (decision in ('verified','unable_to_verify','rejected','under_investigation')),
  rubric jsonb not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create table appeals (
  id bigserial primary key,
  submission_id uuid not null references verification_submissions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  message text,
  status text not null default 'open' check (status in ('open','overturned','upheld')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create unique index appeals_one_per_submission on appeals (submission_id);

-- Community ----------------------------------------------------------------------
create table leaderboard_memberships (
  user_id uuid not null references users(id) on delete cascade,
  board text not null check (board in ('A','B')),
  joined_at timestamptz not null default now(),
  primary key (user_id, board)
);

create table reports (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  kind text not null check (kind in ('content_error','translation_error','abuse','other')),
  target text,
  message text,
  status text not null default 'open' check (status in ('open','closed')),
  handled_by uuid,
  created_at timestamptz not null default now()
);

-- Operations ---------------------------------------------------------------------
create table audit_logs (
  id bigserial primary key,
  actor_id uuid,
  action text not null,
  target text,
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create table feature_flags (
  key text primary key,
  enabled boolean not null default false,
  description text,
  updated_at timestamptz not null default now()
);

create table deletion_requests (
  id bigserial primary key,
  user_ref text not null,
  via text not null default 'app',
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create table pilot_checklist (
  key text primary key,
  title text not null,
  done boolean not null default false,
  note text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table retention_runs (
  id bigserial primary key,
  ran_at timestamptz not null default now(),
  deleted_count int not null default 0
);

-- Minimal public projection: the leaderboard API reads ONLY this view and never returns user ids.
create view v_public_scores as
select m.board, p.tradition, p.pseudonym, l.user_id, l.effective_date,
       l.eligible_points, l.verified_points, l.created_at
from leaderboard_memberships m
join profiles p on p.user_id = m.user_id
join users u on u.id = m.user_id and u.status = 'active'
join ledger_entries l on l.user_id = m.user_id
where p.tradition is not null;
