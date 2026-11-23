-- =============================================================================
-- Configurable group/individual final-grade blend, per defense stage.
-- Like the rubric, each session freezes the blend it was scheduled with, so
-- changing a stage's blend never moves grades that are in progress or locked.
-- =============================================================================

create table public.stage_grading_config (
  stage              public.defense_stage primary key,
  group_weight       numeric(5,2) not null check (group_weight between 0 and 100),
  individual_weight  numeric(5,2) not null check (individual_weight between 0 and 100),
  updated_at         timestamptz not null default now(),
  constraint blend_totals_100 check (group_weight + individual_weight = 100)
);

insert into public.stage_grading_config (stage, group_weight, individual_weight) values
  ('title', 60, 40), ('proposal', 60, 40), ('final', 60, 40);

alter table public.stage_grading_config enable row level security;
create policy grading_config_read  on public.stage_grading_config for select to authenticated using (true);
create policy grading_config_admin on public.stage_grading_config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Per-session frozen blend (backfilled from the stage template)
alter table public.defense_sessions
  add column group_weight numeric(5,2),
  add column individual_weight numeric(5,2);

update public.defense_sessions s
   set group_weight = c.group_weight, individual_weight = c.individual_weight
  from public.stage_grading_config c where c.stage = s.stage;

alter table public.defense_sessions
  alter column group_weight set not null,
  alter column individual_weight set not null,
  add constraint session_blend_range check (group_weight between 0 and 100 and individual_weight between 0 and 100),
  add constraint session_blend_totals_100 check (group_weight + individual_weight = 100);

-- Stamp the blend on schedule and on stage change (values from the client are ignored)
create or replace function public.stamp_session_blend() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage then
    select group_weight, individual_weight into new.group_weight, new.individual_weight
      from public.stage_grading_config where stage = new.stage;
  elsif (new.group_weight, new.individual_weight) is distinct from (old.group_weight, old.individual_weight) then
    if old.is_locked or exists (select 1 from public.rubric_scores where session_id = old.id) then
      raise exception 'Grade blend is frozen once scoring has started';
    end if;
  end if;
  return new;
end $$;

create trigger defense_sessions_stamp_blend
  before insert or update of stage, group_weight, individual_weight on public.defense_sessions
  for each row execute function public.stamp_session_blend();

-- Re-applying a stage's template to an unscored session now refreshes the blend too
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

  update public.defense_sessions s
     set group_weight = c.group_weight, individual_weight = c.individual_weight
    from public.stage_grading_config c
   where s.id = p_session and c.stage = s.stage;
  return n;
end $$;
