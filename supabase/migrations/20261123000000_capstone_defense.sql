-- =============================================================================
-- Capstone Defense Management & Evaluation — Schema, RLS, RPCs
-- Run in the Supabase SQL Editor (or `supabase db push`). Requires PG15+.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role as enum ('admin', 'chair', 'panelist', 'secretary', 'adviser', 'student');
create type public.defense_stage as enum ('title', 'proposal', 'final');
create type public.defense_verdict as enum (
  'passed', 'passed_minor_revisions', 'passed_major_revisions', 're_defense'
);
create type public.panel_role as enum ('chair', 'member');
create type public.rubric_scope as enum ('group', 'individual');
create type public.comment_category as enum (
  'documentation', 'system_ui', 'database_architecture', 'methodology'
);
create type public.comment_severity as enum ('mandatory', 'suggestion');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.users (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null,
  email       text not null unique,
  role        public.user_role not null default 'panelist',
  department  text,
  created_at  timestamptz not null default now()
);

create table public.capstone_projects (
  id              uuid primary key default gen_random_uuid(),
  title           text not null,
  group_label     text,                      -- e.g. 'Group 4'
  abstract        text,
  manuscript_url  text,
  demo_url        text,
  adviser_id      uuid references public.users (id) on delete set null,
  academic_year   text not null,             -- e.g. '2026-2027'
  created_at      timestamptz not null default now()
);

create table public.project_members (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.capstone_projects (id) on delete cascade,
  student_name    text not null,
  student_number  text not null,
  user_id         uuid references public.users (id) on delete set null, -- optional student login
  unique (project_id, student_number)
);

create table public.defense_sessions (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references public.capstone_projects (id) on delete cascade,
  stage                   public.defense_stage not null,
  scheduled_at            timestamptz not null,
  room_or_link            text,
  secretary_id            uuid references public.users (id) on delete set null,
  verdict                 public.defense_verdict,
  is_locked               boolean not null default false,
  locked_at               timestamptz,
  chair_signature_hash    text,
  created_at              timestamptz not null default now(),
  constraint locked_has_verdict check (not is_locked or (verdict is not null and locked_at is not null))
);

create table public.panel_assignments (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.defense_sessions (id) on delete cascade,
  faculty_id       uuid not null references public.users (id) on delete restrict,
  panel_role       public.panel_role not null default 'member',
  has_submitted    boolean not null default false,
  signature_hash   text,
  submitted_at     timestamptz,
  unique (session_id, faculty_id)
);
-- Exactly one chair per session
create unique index one_chair_per_session on public.panel_assignments (session_id) where panel_role = 'chair';

create table public.rubric_criteria (
  id                  uuid primary key default gen_random_uuid(),
  stage               public.defense_stage not null,
  scope               public.rubric_scope not null,
  criterion_name      text not null,
  description         text,
  weight_percentage   numeric(5,2) not null check (weight_percentage > 0 and weight_percentage <= 100),
  max_score           numeric(5,2) not null default 5 check (max_score > 0),
  sort_order          int not null default 0,
  is_active           boolean not null default true
);

create table public.rubric_scores (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.defense_sessions (id) on delete cascade,
  panel_assignment_id   uuid not null references public.panel_assignments (id) on delete cascade,
  student_id            uuid references public.project_members (id) on delete cascade,
  criterion_id          uuid not null references public.rubric_criteria (id) on delete restrict,
  score                 numeric(5,2) not null check (score >= 0),
  updated_at            timestamptz not null default now(),
  unique nulls not distinct (panel_assignment_id, criterion_id, student_id)
);

create table public.panel_comments (
  id                    uuid primary key default gen_random_uuid(),
  session_id            uuid not null references public.defense_sessions (id) on delete cascade,
  panel_assignment_id   uuid not null references public.panel_assignments (id) on delete cascade,
  category              public.comment_category not null,
  severity              public.comment_severity not null default 'suggestion',
  comment_text          text not null check (length(trim(comment_text)) > 0),
  is_resolved           boolean not null default false,
  resolution_note       text,
  resolution_reference  text,               -- page number / commit SHA / URL
  resolved_by           uuid references public.users (id),
  resolved_at           timestamptz,
  created_at            timestamptz not null default now()
);

create table public.defense_minutes (
  id                   uuid primary key default gen_random_uuid(),
  session_id           uuid not null unique references public.defense_sessions (id) on delete cascade,
  recorder_id          uuid not null references public.users (id),
  started_at           timestamptz,
  ended_at             timestamptz,
  attendance_json      jsonb not null default '[]'::jsonb,  -- [{name, role, present}]
  qa_entries_json      jsonb not null default '[]'::jsonb,  -- [{id, timestamp, panelist, question, response, action_required}]
  deliberation_notes   text,
  chair_approved_at    timestamptz,
  updated_at           timestamptz not null default now()
);

create index on public.panel_assignments (faculty_id);
create index on public.rubric_scores (session_id);
create index on public.panel_comments (session_id);
create index on public.defense_sessions (project_id);
create index on public.capstone_projects (adviser_id);

-- -----------------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER → avoid RLS recursion)
-- -----------------------------------------------------------------------------
create or replace function public.current_role_of() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.users where id = auth.uid()), false)
$$;

create or replace function public.my_assignment(p_session uuid) returns public.panel_assignments
language sql stable security definer set search_path = public as $$
  select * from public.panel_assignments where session_id = p_session and faculty_id = auth.uid()
$$;

create or replace function public.is_panelist(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.panel_assignments where session_id = p_session and faculty_id = auth.uid())
$$;

create or replace function public.is_chair(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.panel_assignments
                 where session_id = p_session and faculty_id = auth.uid() and panel_role = 'chair')
$$;

create or replace function public.is_secretary(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.defense_sessions where id = p_session and secretary_id = auth.uid())
$$;

create or replace function public.is_session_adviser(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.defense_sessions s
                 join public.capstone_projects p on p.id = s.project_id
                 where s.id = p_session and p.adviser_id = auth.uid())
$$;

create or replace function public.is_session_student(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.defense_sessions s
                 join public.project_members m on m.project_id = s.project_id
                 where s.id = p_session and m.user_id = auth.uid())
$$;

create or replace function public.session_locked(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_locked from public.defense_sessions where id = p_session), false)
$$;

create or replace function public.all_panel_submitted(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.panel_assignments where session_id = p_session)
     and not exists (select 1 from public.panel_assignments where session_id = p_session and not has_submitted)
$$;

create or replace function public.assignment_submitted(p_assignment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select has_submitted from public.panel_assignments where id = p_assignment), false)
$$;

create or replace function public.owns_assignment(p_assignment uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.panel_assignments where id = p_assignment and faculty_id = auth.uid())
$$;

-- Any participant who may see the session at all
create or replace function public.can_view_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.is_panelist(p_session) or public.is_secretary(p_session)
      or public.is_session_adviser(p_session) or public.is_session_student(p_session)
$$;

create or replace function public.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or exists (select 1 from public.capstone_projects where id = p_project and adviser_id = auth.uid())
      or exists (select 1 from public.project_members where project_id = p_project and user_id = auth.uid())
      or exists (select 1 from public.defense_sessions s where s.project_id = p_project
                 and (public.is_panelist(s.id) or public.is_secretary(s.id)))
$$;

-- -----------------------------------------------------------------------------
-- Integrity triggers
-- -----------------------------------------------------------------------------

-- New auth user → profile. Role is NEVER taken from client metadata (admins promote).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.users (id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users cannot change their own role / email via RLS-update
create or replace function public.protect_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() and (new.role is distinct from old.role or new.email is distinct from old.email) then
    raise exception 'Only admins can change role or email';
  end if;
  return new;
end $$;
create trigger users_protect_role before update on public.users
  for each row execute function public.protect_user_role();

-- Validate scores: range, scope/student consistency, assignment/session match, lock state
create or replace function public.validate_rubric_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  c public.rubric_criteria;
  a public.panel_assignments;
begin
  select * into c from public.rubric_criteria where id = new.criterion_id;
  select * into a from public.panel_assignments where id = new.panel_assignment_id;

  if a.session_id <> new.session_id then raise exception 'Assignment does not belong to session'; end if;
  if a.has_submitted then raise exception 'Evaluation already submitted and signed'; end if;
  if public.session_locked(new.session_id) then raise exception 'Defense session is locked'; end if;
  if new.score > c.max_score then raise exception 'Score % exceeds max %', new.score, c.max_score; end if;
  if c.stage <> (select stage from public.defense_sessions where id = new.session_id) then
    raise exception 'Criterion stage does not match session stage';
  end if;
  if c.scope = 'group' and new.student_id is not null then raise exception 'Group criterion must not target a student'; end if;
  if c.scope = 'individual' then
    if new.student_id is null then raise exception 'Individual criterion requires student_id'; end if;
    if not exists (select 1 from public.project_members m join public.defense_sessions s on s.project_id = m.project_id
                   where m.id = new.student_id and s.id = new.session_id) then
      raise exception 'Student is not a proponent of this project';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger rubric_scores_validate before insert or update on public.rubric_scores
  for each row execute function public.validate_rubric_score();

-- Freeze comments & minutes once locked (resolution columns are handled by RPC)
create or replace function public.block_when_locked() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.session_locked(coalesce(new.session_id, old.session_id))
     and current_setting('app.bypass_lock', true) is distinct from 'on' then
    raise exception 'Defense session is locked';
  end if;
  return coalesce(new, old);
end $$;
create trigger panel_comments_lock before insert or update or delete on public.panel_comments
  for each row execute function public.block_when_locked();
create trigger defense_minutes_lock before insert or update or delete on public.defense_minutes
  for each row execute function public.block_when_locked();
create trigger rubric_scores_lock_delete before delete on public.rubric_scores
  for each row execute function public.block_when_locked();

-- -----------------------------------------------------------------------------
-- RPCs (all state transitions go through these)
-- -----------------------------------------------------------------------------

-- Panelist finalizes + signs their own evaluation.
-- Signature = SHA-256(user_id | submitted_at ISO | canonical score payload)
create or replace function public.submit_evaluation(p_session uuid)
returns public.panel_assignments
language plpgsql security definer set search_path = public as $$
declare
  a public.panel_assignments;
  v_now timestamptz := now();
  v_payload text;
  v_expected int;
  v_actual int;
begin
  select * into a from public.panel_assignments where session_id = p_session and faculty_id = auth.uid() for update;
  if a.id is null then raise exception 'Not assigned to this session'; end if;
  if a.has_submitted then raise exception 'Already submitted'; end if;
  if public.session_locked(p_session) then raise exception 'Session locked'; end if;

  -- completeness: every group criterion + every individual criterion × student must be scored
  select count(*) filter (where c.scope = 'group')
       + count(*) filter (where c.scope = 'individual') * (select count(*) from public.project_members m
                                                           join public.defense_sessions s on s.project_id = m.project_id
                                                           where s.id = p_session)
    into v_expected
    from public.rubric_criteria c
   where c.is_active and c.stage = (select stage from public.defense_sessions where id = p_session);
  select count(*) into v_actual from public.rubric_scores where panel_assignment_id = a.id;
  if v_actual < v_expected then
    raise exception 'Incomplete evaluation: % of % scores entered', v_actual, v_expected;
  end if;

  select coalesce(string_agg(criterion_id::text || ':' || coalesce(student_id::text, 'group') || ':' || score::text,
                             ',' order by criterion_id, student_id nulls first), '')
    into v_payload from public.rubric_scores where panel_assignment_id = a.id;

  update public.panel_assignments
     set has_submitted = true,
         submitted_at = v_now,
         signature_hash = encode(digest(auth.uid()::text || '|' || to_char(v_now at time zone 'utc',
                                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || v_payload, 'sha256'), 'hex')
   where id = a.id
  returning * into a;
  return a;
end $$;

-- Chair finalizes: requires all submissions; freezes everything; chair signs.
create or replace function public.finalize_defense(p_session uuid, p_verdict public.defense_verdict)
returns public.defense_sessions
language plpgsql security definer set search_path = public as $$
declare
  s public.defense_sessions;
  v_now timestamptz := now();
  v_payload text;
begin
  if not public.is_chair(p_session) then raise exception 'Only the Defense Chair can finalize'; end if;
  if not public.all_panel_submitted(p_session) then raise exception 'Not all panelists have submitted'; end if;

  select string_agg(signature_hash, ',' order by id) into v_payload
    from public.panel_assignments where session_id = p_session;

  update public.defense_minutes set chair_approved_at = v_now, ended_at = coalesce(ended_at, v_now)
   where session_id = p_session;

  update public.defense_sessions
     set verdict = p_verdict, is_locked = true, locked_at = v_now,
         chair_signature_hash = encode(digest(auth.uid()::text || '|' || to_char(v_now at time zone 'utc',
                                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || p_verdict::text || '|' || v_payload, 'sha256'), 'hex')
   where id = p_session and not is_locked
  returning * into s;
  if s.id is null then raise exception 'Session already locked'; end if;
  return s;
end $$;

-- Adviser / proponent marks a mandatory revision resolved (post-lock only).
create or replace function public.resolve_revision(p_comment uuid, p_resolved boolean, p_note text, p_reference text)
returns public.panel_comments
language plpgsql security definer set search_path = public as $$
declare c public.panel_comments;
begin
  select * into c from public.panel_comments where id = p_comment;
  if c.id is null then raise exception 'Comment not found'; end if;
  if not (public.is_admin() or public.is_session_adviser(c.session_id) or public.is_session_student(c.session_id)
          or public.is_chair(c.session_id)) then
    raise exception 'Not permitted';
  end if;
  if not public.session_locked(c.session_id) then raise exception 'Revisions are tracked after the defense is locked'; end if;

  perform set_config('app.bypass_lock', 'on', true);
  update public.panel_comments
     set is_resolved = p_resolved, resolution_note = p_note, resolution_reference = p_reference,
         resolved_by = case when p_resolved then auth.uid() end,
         resolved_at = case when p_resolved then now() end
   where id = p_comment returning * into c;
  perform set_config('app.bypass_lock', 'off', true);
  return c;
end $$;

-- Revision compliance checklist (mandatory items only); RLS of base table applies.
create or replace view public.revision_checklist with (security_invoker = true) as
  select c.*, s.project_id, s.stage
    from public.panel_comments c join public.defense_sessions s on s.id = c.session_id
   where c.severity = 'mandatory';

-- -----------------------------------------------------------------------------
-- Row-Level Security
-- -----------------------------------------------------------------------------
alter table public.users              enable row level security;
alter table public.capstone_projects  enable row level security;
alter table public.project_members    enable row level security;
alter table public.defense_sessions   enable row level security;
alter table public.panel_assignments  enable row level security;
alter table public.rubric_criteria    enable row level security;
alter table public.rubric_scores      enable row level security;
alter table public.panel_comments     enable row level security;
alter table public.defense_minutes    enable row level security;

-- users
create policy users_read   on public.users for select to authenticated using (true);
create policy users_self   on public.users for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy users_admin  on public.users for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- projects & members
create policy projects_read  on public.capstone_projects for select to authenticated using (public.can_view_project(id));
create policy projects_admin on public.capstone_projects for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy members_read   on public.project_members for select to authenticated using (public.can_view_project(project_id));
create policy members_admin  on public.project_members for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- sessions (verdict/lock only via finalize_defense RPC)
create policy sessions_read  on public.defense_sessions for select to authenticated using (public.can_view_session(id));
create policy sessions_admin on public.defense_sessions for all to authenticated
  using (public.is_admin() and not is_locked) with check (public.is_admin());

-- panel assignments: participants see submission status (Realtime indicators). Writes: admin only.
create policy assignments_read  on public.panel_assignments for select to authenticated using (public.can_view_session(session_id));
create policy assignments_admin on public.panel_assignments for all to authenticated
  using (public.is_admin() and not public.session_locked(session_id)) with check (public.is_admin());

-- rubric criteria
create policy criteria_read  on public.rubric_criteria for select to authenticated using (true);
create policy criteria_admin on public.rubric_criteria for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- rubric scores — BLIND GRADING
--  * own scores: always
--  * chair: every score once ALL panelists submitted (Consolidated Deliberation View)
--  * other panelists: only after their own submission is final, and only submitted rows; or after lock
--  * admin / adviser / student: only after lock
create policy scores_read on public.rubric_scores for select to authenticated using (
  public.owns_assignment(panel_assignment_id)
  or public.session_locked(session_id) and public.can_view_session(session_id)
  or (public.is_chair(session_id) and public.all_panel_submitted(session_id))
  or (public.is_panelist(session_id)
      and (public.my_assignment(session_id)).has_submitted
      and public.assignment_submitted(panel_assignment_id))
);
create policy scores_insert on public.rubric_scores for insert to authenticated with check (
  public.owns_assignment(panel_assignment_id) and not public.assignment_submitted(panel_assignment_id)
  and not public.session_locked(session_id)
);
create policy scores_update on public.rubric_scores for update to authenticated
  using (public.owns_assignment(panel_assignment_id) and not public.assignment_submitted(panel_assignment_id))
  with check (public.owns_assignment(panel_assignment_id) and not public.session_locked(session_id));
create policy scores_delete on public.rubric_scores for delete to authenticated
  using (public.owns_assignment(panel_assignment_id) and not public.assignment_submitted(panel_assignment_id));

-- panel comments
create policy comments_read on public.panel_comments for select to authenticated using (
  public.owns_assignment(panel_assignment_id)
  or public.is_admin() or public.is_chair(session_id) or public.is_secretary(session_id)
  or (public.session_locked(session_id) and public.can_view_session(session_id))
);
create policy comments_write on public.panel_comments for insert to authenticated
  with check (public.owns_assignment(panel_assignment_id) and not public.session_locked(session_id));
create policy comments_update on public.panel_comments for update to authenticated
  using (public.owns_assignment(panel_assignment_id)) with check (public.owns_assignment(panel_assignment_id));
create policy comments_delete on public.panel_comments for delete to authenticated
  using (public.owns_assignment(panel_assignment_id));

-- defense minutes: secretary writes; panel reads live; adviser/student after lock
create policy minutes_read on public.defense_minutes for select to authenticated using (
  public.is_admin() or public.is_secretary(session_id) or public.is_panelist(session_id)
  or (public.session_locked(session_id) and public.can_view_session(session_id))
);
create policy minutes_insert on public.defense_minutes for insert to authenticated
  with check (public.is_secretary(session_id) and recorder_id = auth.uid());
create policy minutes_update on public.defense_minutes for update to authenticated
  using (public.is_secretary(session_id) and chair_approved_at is null)
  with check (public.is_secretary(session_id));

-- RPC grants
revoke all on function public.submit_evaluation(uuid) from public, anon;
revoke all on function public.finalize_defense(uuid, public.defense_verdict) from public, anon;
revoke all on function public.resolve_revision(uuid, boolean, text, text) from public, anon;
grant execute on function public.submit_evaluation(uuid) to authenticated;
grant execute on function public.finalize_defense(uuid, public.defense_verdict) to authenticated;
grant execute on function public.resolve_revision(uuid, boolean, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Realtime (RLS is enforced on postgres_changes)
-- -----------------------------------------------------------------------------
alter publication supabase_realtime add table
  public.panel_assignments, public.defense_sessions, public.defense_minutes, public.panel_comments;
