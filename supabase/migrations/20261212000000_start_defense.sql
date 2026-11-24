-- Panelists can enter ratings only after the Defense Chair or a Coordinator starts the defense.
alter table public.defense_sessions
  add column started_at timestamptz,
  add column started_by uuid references public.users (id) on delete set null;
create index defense_sessions_started_by_idx on public.defense_sessions (started_by);

create or replace function public.start_defense(p_session uuid) returns public.defense_sessions
language plpgsql security definer set search_path = public as $$
declare s public.defense_sessions;
begin
  if not (public.is_admin() or public.is_chair(p_session)) then
    raise exception 'Only the Defense Chair or the Coordinator can start the defense';
  end if;
  select * into s from public.defense_sessions where id = p_session for update;
  if s.id is null then raise exception 'Defense not found'; end if;
  if s.is_locked then raise exception 'This defense is already locked'; end if;
  if s.started_at is not null then return s; end if;
  update public.defense_sessions set started_at = now(), started_by = auth.uid() where id = p_session returning * into s;
  return s;
end $$;
revoke execute on function public.start_defense(uuid) from public, anon;
grant execute on function public.start_defense(uuid) to authenticated;

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
  if (select started_at from public.defense_sessions where id = new.session_id) is null then
    raise exception 'The defense has not started yet. Wait for the Defense Chair or the Coordinator to start it.';
  end if;
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
