-- =============================================================================
-- Admin: scheduling + rubric configuration
--  * Each defense session gets a frozen rubric snapshot (session_criteria) at
--    scheduling time, so editing templates never changes in-progress grades.
--  * Criteria used by a scored/locked session are copy-on-write: revise_criterion()
--    retires the old row and inserts a new version. After saving a stage's rubric,
--    call sync_session_rubric() for each unscored session of that stage.
-- =============================================================================

create table public.session_criteria (
  session_id    uuid not null references public.defense_sessions (id) on delete cascade,
  criterion_id  uuid not null references public.rubric_criteria (id) on delete restrict,
  primary key (session_id, criterion_id)
);
create index on public.session_criteria (criterion_id);

alter table public.session_criteria enable row level security;
create policy session_criteria_read  on public.session_criteria for select to authenticated using (public.can_view_session(session_id));
create policy session_criteria_admin on public.session_criteria for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Backfill existing sessions with the currently active rubric
insert into public.session_criteria (session_id, criterion_id)
select s.id, c.id from public.defense_sessions s
join public.rubric_criteria c on c.stage = s.stage and c.is_active
on conflict do nothing;

-- Snapshot on schedule (and on stage change while unscored)
create or replace function public.snapshot_session_rubric() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.stage = old.stage then return new; end if;
    if exists (select 1 from public.rubric_scores where session_id = new.id) then
      raise exception 'Cannot change stage after scoring has started';
    end if;
    delete from public.session_criteria where session_id = new.id;
  end if;
  insert into public.session_criteria (session_id, criterion_id)
  select new.id, c.id from public.rubric_criteria c where c.stage = new.stage and c.is_active;
  return new;
end $$;

create trigger defense_sessions_snapshot_rubric
  after insert or update of stage on public.defense_sessions
  for each row execute function public.snapshot_session_rubric();

-- Re-apply the current template to a session nobody has scored yet
create or replace function public.sync_session_rubric(p_session uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if public.session_locked(p_session) then raise exception 'Session locked'; end if;
  if exists (select 1 from public.rubric_scores where session_id = p_session) then
    raise exception 'Scoring has started; rubric snapshot is frozen';
  end if;
  delete from public.session_criteria where session_id = p_session;
  insert into public.session_criteria (session_id, criterion_id)
  select p_session, c.id from public.rubric_criteria c
  join public.defense_sessions s on s.id = p_session
  where c.stage = s.stage and c.is_active;
  get diagnostics n = row_count;
  return n;
end $$;

-- A criterion is frozen once a session that has scores (or is locked) uses it.
-- Unscored sessions just get re-synced, so editing in place is fine for them.
create or replace function public.criterion_is_frozen(p_criterion uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.session_criteria sc join public.defense_sessions s on s.id = sc.session_id
     where sc.criterion_id = p_criterion
       and (s.is_locked or exists (select 1 from public.rubric_scores r where r.session_id = s.id))
  )
$$;

-- Frozen criteria: only description / sort_order / is_active may change in place
create or replace function public.protect_used_criteria() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' and exists (select 1 from public.session_criteria where criterion_id = old.id) then
    raise exception 'Criterion is used by a defense session; deactivate it instead';
  end if;
  if public.criterion_is_frozen(old.id) then
    if (new.stage, new.scope, new.criterion_name, new.weight_percentage, new.max_score)
       is distinct from (old.stage, old.scope, old.criterion_name, old.weight_percentage, old.max_score) then
      raise exception 'Criterion is used by a defense session; use revise_criterion()';
    end if;
  end if;
  return coalesce(new, old);
end $$;

create trigger rubric_criteria_protect before update or delete on public.rubric_criteria
  for each row execute function public.protect_used_criteria();

-- Copy-on-write edit. Returns the row that is now active.
create or replace function public.revise_criterion(
  p_id uuid, p_name text, p_description text, p_weight numeric, p_max numeric, p_sort int
) returns public.rubric_criteria
language plpgsql security definer set search_path = public as $$
declare old_c public.rubric_criteria; new_c public.rubric_criteria;
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  select * into old_c from public.rubric_criteria where id = p_id for update;
  if old_c.id is null then raise exception 'Criterion not found'; end if;

  if public.criterion_is_frozen(p_id) then
    update public.rubric_criteria set is_active = false where id = p_id;
    insert into public.rubric_criteria (stage, scope, criterion_name, description, weight_percentage, max_score, sort_order)
    values (old_c.stage, old_c.scope, p_name, p_description, p_weight, p_max, p_sort)
    returning * into new_c;
  else
    update public.rubric_criteria
       set criterion_name = p_name, description = p_description, weight_percentage = p_weight,
           max_score = p_max, sort_order = p_sort
     where id = p_id returning * into new_c;
  end if;
  return new_c;
end $$;

-- Weight totals per stage/scope (should be 100 each) for the admin UI
create or replace view public.rubric_weight_totals with (security_invoker = true) as
  select stage, scope, sum(weight_percentage) as total_weight, count(*) as criteria_count
    from public.rubric_criteria where is_active group by stage, scope;

-- Scores must target a criterion in the session's snapshot
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
  if not exists (select 1 from public.session_criteria where session_id = new.session_id and criterion_id = new.criterion_id) then
    raise exception 'Criterion is not part of this session''s rubric';
  end if;
  if new.score > c.max_score then raise exception 'Score % exceeds max %', new.score, c.max_score; end if;
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

-- Completeness check now counts the session snapshot
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

  select count(*) filter (where c.scope = 'group')
       + count(*) filter (where c.scope = 'individual') * (select count(*) from public.project_members m
                                                           join public.defense_sessions s on s.project_id = m.project_id
                                                           where s.id = p_session)
    into v_expected
    from public.session_criteria sc join public.rubric_criteria c on c.id = sc.criterion_id
   where sc.session_id = p_session;
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

-- Admins may only remove sessions that have no scores
create or replace function public.protect_scored_session() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.rubric_scores where session_id = old.id) then
    raise exception 'Cannot delete a session with recorded scores';
  end if;
  return old;
end $$;
create trigger defense_sessions_protect_delete before delete on public.defense_sessions
  for each row execute function public.protect_scored_session();

-- Panel changes only for panelists who have not scored yet
create or replace function public.protect_scored_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.rubric_scores where panel_assignment_id = old.id) then
    raise exception 'Panelist has already entered scores';
  end if;
  return coalesce(new, old);
end $$;
create trigger panel_assignments_protect before delete or update of faculty_id on public.panel_assignments
  for each row execute function public.protect_scored_assignment();

revoke all on function public.sync_session_rubric(uuid) from public, anon;
revoke all on function public.revise_criterion(uuid, text, text, numeric, numeric, int) from public, anon;
grant execute on function public.sync_session_rubric(uuid) to authenticated;
grant execute on function public.revise_criterion(uuid, text, text, numeric, numeric, int) to authenticated;
