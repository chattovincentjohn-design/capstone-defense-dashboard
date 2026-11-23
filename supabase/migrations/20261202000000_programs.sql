-- =============================================================================
-- Multiple courses (programs): BSIT, BSISM, BS Agriculture, BS Criminology, BS Education.
--  * Each program has its own Coordinator(s), rubric and group/individual split.
--  * A super admin manages every program, creates Coordinators and adds programs.
--  * Faculty may sit on panels of any program; access is still per assignment.
-- Existing data becomes BSIT.
-- =============================================================================

create table public.programs (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code ~ '^[A-Z0-9-]{2,12}$'),
  name          text not null check (length(trim(name)) > 0),
  project_term  text not null default 'Thesis' check (project_term in ('Capstone', 'Thesis', 'Research')),
  created_at    timestamptz not null default now()
);
insert into public.programs (code, name, project_term) values
  ('BSIT',   'BS Information Technology',          'Capstone'),
  ('BSISM',  'BS Industrial Security Management',  'Thesis'),
  ('BSA',    'BS Agriculture',                     'Thesis'),
  ('BSCRIM', 'BS Criminology',                     'Thesis'),
  ('BSED',   'BS Education',                       'Thesis');

alter table public.programs enable row level security;
create policy programs_read on public.programs for select to authenticated using (true);

-- ---- Link people, projects, rubrics and grade splits to a program ----------
alter table public.users add column program_id uuid references public.programs (id) on delete set null;
alter table public.capstone_projects add column program_id uuid references public.programs (id) on delete restrict;
alter table public.rubric_criteria add column program_id uuid references public.programs (id) on delete cascade;
alter table public.stage_grading_config add column program_id uuid references public.programs (id) on delete cascade;

do $$
declare bsit uuid := (select id from public.programs where code = 'BSIT');
begin
  update public.users set program_id = bsit where program_id is null;
  update public.capstone_projects set program_id = bsit where program_id is null;
  update public.rubric_criteria set program_id = bsit where program_id is null;
  update public.stage_grading_config set program_id = bsit where program_id is null;
end $$;

-- One grade split per (program, stage) — swap the key before copying rows
alter table public.stage_grading_config alter column program_id set not null;
alter table public.stage_grading_config drop constraint stage_grading_config_pkey;
alter table public.stage_grading_config add primary key (program_id, stage);

do $$
declare bsit uuid := (select id from public.programs where code = 'BSIT');
begin
  -- Every other program starts with a copy of BSIT's active rubric and split
  insert into public.rubric_criteria (program_id, stage, scope, criterion_name, description, weight_percentage, max_score, sort_order)
  select p.id, c.stage, c.scope, c.criterion_name, c.description, c.weight_percentage, c.max_score, c.sort_order
    from public.programs p cross join public.rubric_criteria c
   where p.code <> 'BSIT' and c.program_id = bsit and c.is_active;
  insert into public.stage_grading_config (program_id, stage, group_weight, individual_weight)
  select p.id, g.stage, g.group_weight, g.individual_weight
    from public.programs p cross join public.stage_grading_config g
   where p.code <> 'BSIT' and g.program_id = bsit;
end $$;

alter table public.capstone_projects alter column program_id set not null;
alter table public.rubric_criteria alter column program_id set not null;
create index on public.capstone_projects (program_id);
create index on public.rubric_criteria (program_id, stage);
create index on public.users (program_id);

-- ---- Program-scoped admin checks ----------------------------------------------
create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'superadmin' from public.users where id = auth.uid()), false)
$$;

-- "Some kind of admin" (Coordinator of any program, or super admin)
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'superadmin') from public.users where id = auth.uid()), false)
$$;

create or replace function public.my_program() returns uuid
language sql stable security definer set search_path = public as $$
  select program_id from public.users where id = auth.uid()
$$;

create or replace function public.admin_of_program(p_program uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_superadmin()
      or exists (select 1 from public.users where id = auth.uid() and role = 'admin' and program_id = p_program)
$$;

create or replace function public.admin_of_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_of_program((select program_id from public.capstone_projects where id = p_project))
$$;

create or replace function public.admin_of_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_of_project((select project_id from public.defense_sessions where id = p_session))
$$;

-- Programs: only super admins add/rename
create policy programs_superadmin on public.programs for all to authenticated
  using (public.is_superadmin()) with check (public.is_superadmin());

-- ---- Visibility helpers now program-scoped -------------------------------------
create or replace function public.can_view_session(p_session uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_of_session(p_session) or public.is_panelist(p_session) or public.is_secretary(p_session)
      or public.is_session_adviser(p_session) or public.is_session_student(p_session)
$$;

create or replace function public.can_view_project(p_project uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.admin_of_project(p_project)
      or exists (select 1 from public.capstone_projects where id = p_project and adviser_id = auth.uid())
      or exists (select 1 from public.project_members where project_id = p_project and user_id = auth.uid())
      or exists (select 1 from public.defense_sessions s where s.project_id = p_project
                 and (public.is_panelist(s.id) or public.is_secretary(s.id)))
$$;

-- ---- Policies: replace global is_admin() with program-scoped checks -----------
drop policy users_admin on public.users;
create policy users_admin on public.users for all to authenticated
  using (public.is_superadmin() or (public.is_admin() and program_id = public.my_program() and role <> 'superadmin'))
  with check (public.is_superadmin() or (public.is_admin() and program_id = public.my_program() and role <> 'superadmin'));

drop policy projects_admin on public.capstone_projects;
create policy projects_admin on public.capstone_projects for all to authenticated
  using (public.admin_of_program(program_id)) with check (public.admin_of_program(program_id));

drop policy members_admin on public.project_members;
create policy members_admin on public.project_members for all to authenticated
  using (public.admin_of_project(project_id)) with check (public.admin_of_project(project_id));

drop policy sessions_admin on public.defense_sessions;
create policy sessions_admin on public.defense_sessions for all to authenticated
  using (public.admin_of_project(project_id) and not is_locked) with check (public.admin_of_project(project_id));

drop policy assignments_admin on public.panel_assignments;
create policy assignments_admin on public.panel_assignments for all to authenticated
  using (public.admin_of_session(session_id) and not public.session_locked(session_id))
  with check (public.admin_of_session(session_id));

drop policy criteria_admin on public.rubric_criteria;
create policy criteria_admin on public.rubric_criteria for all to authenticated
  using (public.admin_of_program(program_id)) with check (public.admin_of_program(program_id));

drop policy session_criteria_admin on public.session_criteria;
create policy session_criteria_admin on public.session_criteria for all to authenticated
  using (public.admin_of_session(session_id)) with check (public.admin_of_session(session_id));

drop policy grading_config_admin on public.stage_grading_config;
create policy grading_config_admin on public.stage_grading_config for all to authenticated
  using (public.admin_of_program(program_id)) with check (public.admin_of_program(program_id));

drop policy minutes_admin on public.defense_minutes;
create policy minutes_admin on public.defense_minutes for all to authenticated
  using (public.admin_of_session(session_id)) with check (public.admin_of_session(session_id));

drop policy minutes_read on public.defense_minutes;
create policy minutes_read on public.defense_minutes for select to authenticated using (
  public.admin_of_session(session_id) or public.is_secretary(session_id) or public.is_panelist(session_id)
  or (public.session_locked(session_id) and public.can_view_session(session_id))
);

drop policy comments_read on public.panel_comments;
create policy comments_read on public.panel_comments for select to authenticated using (
  public.owns_assignment(panel_assignment_id)
  or public.admin_of_session(session_id) or public.is_chair(session_id) or public.is_secretary(session_id)
  or (public.session_locked(session_id) and public.can_view_session(session_id))
);

drop policy scores_read on public.rubric_scores;
create policy scores_read on public.rubric_scores for select to authenticated using (
  public.owns_assignment(panel_assignment_id)
  or (public.session_locked(session_id) and (
        public.admin_of_session(session_id) or public.is_panelist(session_id) or public.is_secretary(session_id)
        or public.is_session_adviser(session_id)
        or (public.is_session_student(session_id) and (student_id is null or public.is_my_member(student_id)))))
  or (public.is_chair(session_id) and public.all_panel_submitted(session_id))
  or (public.is_panelist(session_id)
      and (public.my_assignment(session_id)).has_submitted
      and public.assignment_submitted(panel_assignment_id))
);

-- ---- Rubric snapshot / blend / sync use the session's program ------------------
create or replace function public.snapshot_session_rubric() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_program uuid := (select program_id from public.capstone_projects where id = new.project_id);
begin
  if tg_op = 'UPDATE' then
    if new.stage = old.stage then return new; end if;
    if exists (select 1 from public.rubric_scores where session_id = new.id) then
      raise exception 'Cannot change stage after scoring has started';
    end if;
    delete from public.session_criteria where session_id = new.id;
  end if;
  insert into public.session_criteria (session_id, criterion_id)
  select new.id, c.id from public.rubric_criteria c
   where c.stage = new.stage and c.program_id = v_program and c.is_active;
  return new;
end $$;

create or replace function public.stamp_session_blend() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_program uuid := (select program_id from public.capstone_projects where id = new.project_id);
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    select group_weight, individual_weight into new.group_weight, new.individual_weight
      from public.stage_grading_config where stage = new.stage and program_id = v_program;
  elsif (new.group_weight, new.individual_weight) is distinct from (old.group_weight, old.individual_weight) then
    if old.is_locked or exists (select 1 from public.rubric_scores where session_id = old.id) then
      raise exception 'Grade blend is frozen once scoring has started';
    end if;
  end if;
  return new;
end $$;

create or replace function public.sync_session_rubric(p_session uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; v_program uuid; v_stage public.defense_stage;
begin
  if not public.admin_of_session(p_session) then raise exception 'Only this course''s Coordinator can do that'; end if;
  if public.session_locked(p_session) then raise exception 'Session locked'; end if;
  if exists (select 1 from public.rubric_scores where session_id = p_session) then
    raise exception 'Scoring has started; rubric snapshot is frozen';
  end if;
  select p.program_id, s.stage into v_program, v_stage
    from public.defense_sessions s join public.capstone_projects p on p.id = s.project_id where s.id = p_session;
  delete from public.session_criteria where session_id = p_session;
  insert into public.session_criteria (session_id, criterion_id)
  select p_session, c.id from public.rubric_criteria c
   where c.stage = v_stage and c.program_id = v_program and c.is_active;
  get diagnostics n = row_count;
  update public.defense_sessions s
     set group_weight = g.group_weight, individual_weight = g.individual_weight
    from public.stage_grading_config g
   where s.id = p_session and g.stage = v_stage and g.program_id = v_program;
  return n;
end $$;

create or replace function public.revise_criterion(
  p_id uuid, p_name text, p_description text, p_weight numeric, p_max numeric, p_sort int
) returns public.rubric_criteria
language plpgsql security definer set search_path = public as $$
declare old_c public.rubric_criteria; new_c public.rubric_criteria;
begin
  select * into old_c from public.rubric_criteria where id = p_id for update;
  if old_c.id is null then raise exception 'Criterion not found'; end if;
  if not public.admin_of_program(old_c.program_id) then raise exception 'Only this course''s Coordinator can do that'; end if;

  if public.criterion_is_frozen(p_id) then
    update public.rubric_criteria set is_active = false where id = p_id;
    insert into public.rubric_criteria (program_id, stage, scope, criterion_name, description, weight_percentage, max_score, sort_order)
    values (old_c.program_id, old_c.stage, old_c.scope, p_name, p_description, p_weight, p_max, p_sort)
    returning * into new_c;
  else
    update public.rubric_criteria
       set criterion_name = p_name, description = p_description, weight_percentage = p_weight,
           max_score = p_max, sort_order = p_sort
     where id = p_id returning * into new_c;
  end if;
  return new_c;
end $$;

create or replace function public.resolve_revision(p_comment uuid, p_resolved boolean, p_note text, p_reference text)
returns public.panel_comments
language plpgsql security definer set search_path = public as $$
declare c public.panel_comments;
begin
  select * into c from public.panel_comments where id = p_comment;
  if c.id is null then raise exception 'Comment not found'; end if;
  if not (public.admin_of_session(c.session_id) or public.is_session_adviser(c.session_id)
          or public.is_session_student(c.session_id) or public.is_chair(c.session_id)) then
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

-- ---- Role / program changes ------------------------------------------------------
create or replace function public.protect_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') not in ('authenticated', 'anon') then return new; end if;  -- trusted contexts
  if new.role is distinct from old.role or new.email is distinct from old.email or new.program_id is distinct from old.program_id then
    if not public.is_superadmin() then
      -- A brand-new profile (no course yet) may be claimed into the Coordinator's own course.
      if not (public.is_admin() and (old.program_id = public.my_program()
              or (old.program_id is null and new.program_id = public.my_program()))) then
        raise exception 'Only this course''s Coordinator can change role or email';
      end if;
      if new.role = 'superadmin' or old.role = 'superadmin' then raise exception 'Only a super admin can do that'; end if;
      if new.program_id is distinct from old.program_id
         and not (old.program_id is null and new.program_id = public.my_program()) then
        raise exception 'Only a super admin can move people between courses';
      end if;
    end if;
  end if;
  if old.id = auth.uid() and old.role in ('admin', 'superadmin') and new.role is distinct from old.role then
    raise exception 'You cannot change your own administrator role';
  end if;
  return new;
end $$;

-- ---- Accounts: program-scoped -----------------------------------------------------
drop function public.admin_list_accounts();
create function public.admin_list_accounts()
returns table (id uuid, email text, full_name text, role public.user_role, department text, program_id uuid,
               created_at timestamptz, last_sign_in_at timestamptz, is_active boolean)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email, u.full_name, u.role, u.department, u.program_id, u.created_at, a.last_sign_in_at,
         (a.banned_until is null or a.banned_until <= now())
    from public.users u join auth.users a on a.id = u.id
   where public.is_superadmin() or (public.is_admin() and u.program_id = public.my_program() and u.role <> 'superadmin')
   order by u.full_name
$$;

drop function public.admin_create_account(text, text, public.user_role, text);
create function public.admin_create_account(
  p_email text, p_full_name text, p_role public.user_role, p_department text, p_program uuid default null
) returns table (user_id uuid, temp_password text)
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
  v_name text := trim(p_full_name);
  v_pw text := private.temp_password();
  v_program uuid;
begin
  if not public.is_admin() then raise exception 'Only a Coordinator can create accounts'; end if;
  if public.is_superadmin() then
    v_program := case when p_role = 'superadmin' then null else p_program end;
    if p_role <> 'superadmin' and v_program is null then raise exception 'Choose a course for this account'; end if;
  else
    if p_role = 'superadmin' then raise exception 'Only a super admin can create super admins'; end if;
    v_program := public.my_program();
    if p_program is not null and p_program <> v_program then raise exception 'You can only add accounts to your own course'; end if;
  end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if v_name = '' then raise exception 'Full name is required'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(v_pw, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v_name),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', null, now(), now());

  update public.users
     set role = p_role, full_name = v_name, department = nullif(trim(coalesce(p_department, '')), ''), program_id = v_program
   where id = v_id;
  return query select v_id, v_pw;
end $$;

-- Only Coordinators of the target's course (or a super admin) may manage an account
create or replace function public.can_manage_account(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_superadmin()
      or exists (select 1 from public.users t where t.id = p_user and t.role <> 'superadmin'
                 and public.is_admin() and t.program_id = public.my_program())
$$;

create or replace function public.admin_reset_password(p_user uuid) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_pw text := private.temp_password();
begin
  if not public.can_manage_account(p_user) then raise exception 'You can only manage accounts in your own course'; end if;
  update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  delete from auth.sessions where user_id = p_user;
  return v_pw;
end $$;

create or replace function public.admin_set_account_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.can_manage_account(p_user) then raise exception 'You can only manage accounts in your own course'; end if;
  if p_user = auth.uid() and not p_active then raise exception 'You cannot disable your own account'; end if;
  update auth.users
     set banned_until = case when p_active then null else now() + interval '100 years' end, updated_at = now()
   where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  if not p_active then delete from auth.sessions where user_id = p_user; end if;
end $$;

create or replace function public.admin_create_member_account(p_member uuid, p_email text default null)
returns table (user_id uuid, temp_password text, linked_existing boolean)
language plpgsql security definer set search_path = public, auth as $$
declare
  m public.project_members;
  v_email text; v_group text; v_program uuid;
  v_existing uuid; v_existing_role public.user_role;
  v_new_id uuid; v_pw text;
begin
  select * into m from public.project_members where id = p_member for update;
  if m.id is null then raise exception 'Member not found'; end if;
  if not public.admin_of_project(m.project_id) then raise exception 'Only this course''s Coordinator can create student accounts'; end if;
  if m.user_id is not null then raise exception '% already has an account', m.student_name; end if;

  v_email := lower(trim(coalesce(nullif(trim(p_email), ''), m.email, '')));
  if v_email = '' then raise exception 'Add an email for % first', m.student_name; end if;

  select u.id, u.role into v_existing, v_existing_role from public.users u where lower(u.email) = v_email;
  if v_existing is not null then
    if v_existing_role <> 'student' then raise exception '% belongs to a faculty account', v_email; end if;
    update public.project_members set user_id = v_existing, email = v_email where id = p_member;
    return query select v_existing, null::text, true;
    return;
  end if;

  select coalesce(group_label, 'Proponent'), program_id into v_group, v_program
    from public.capstone_projects where id = m.project_id;
  select c.user_id, c.temp_password into v_new_id, v_pw
    from public.admin_create_account(v_email, m.student_name, 'student', v_group, v_program) c;
  update public.project_members set user_id = v_new_id, email = v_email where id = p_member;
  return query select v_new_id, v_pw, false;
end $$;

-- New program, starting from a copy of another program's rubric and split (default BSIT)
create or replace function public.create_program(p_code text, p_name text, p_term text default 'Thesis', p_copy_from uuid default null)
returns public.programs
language plpgsql security definer set search_path = public as $$
declare pr public.programs; v_src uuid;
begin
  if not public.is_superadmin() then raise exception 'Only a super admin can add courses'; end if;
  insert into public.programs (code, name, project_term) values (upper(trim(p_code)), trim(p_name), p_term) returning * into pr;
  v_src := coalesce(p_copy_from, (select id from public.programs where code = 'BSIT'));
  insert into public.rubric_criteria (program_id, stage, scope, criterion_name, description, weight_percentage, max_score, sort_order)
  select pr.id, stage, scope, criterion_name, description, weight_percentage, max_score, sort_order
    from public.rubric_criteria where program_id = v_src and is_active;
  insert into public.stage_grading_config (program_id, stage, group_weight, individual_weight)
  select pr.id, stage, group_weight, individual_weight from public.stage_grading_config where program_id = v_src;
  return pr;
end $$;

-- ---- Grants -------------------------------------------------------------------------
revoke execute on function public.is_superadmin(), public.my_program(), public.admin_of_program(uuid),
  public.admin_of_project(uuid), public.admin_of_session(uuid), public.can_manage_account(uuid),
  public.admin_list_accounts(), public.admin_create_account(text, text, public.user_role, text, uuid),
  public.create_program(text, text, text, uuid)
from public, anon;
grant execute on function public.is_superadmin(), public.my_program(), public.admin_of_program(uuid),
  public.admin_of_project(uuid), public.admin_of_session(uuid), public.can_manage_account(uuid),
  public.admin_list_accounts(), public.admin_create_account(text, text, public.user_role, text, uuid),
  public.create_program(text, text, text, uuid)
to authenticated;
revoke execute on function public.protect_user_role() from public, anon, authenticated;
