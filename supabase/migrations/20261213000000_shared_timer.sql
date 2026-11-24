-- Shared defense timer controlled by the Defense Chair (Coordinator as backup).
-- timer = { phases: [{label, minutes}], phase: int, running: bool, started_at: timestamptz|null, elapsed: seconds }
-- Remaining time = phases[phase].minutes*60 - (elapsed + (running ? now - started_at : 0)).
alter table public.defense_sessions add column timer jsonb;

create or replace function public.timer_action(p_session uuid, p_action text, p_phases jsonb default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  s public.defense_sessions;
  t jsonb;
  ph jsonb;
  n int;
  v_elapsed numeric;
  e jsonb;
begin
  if not (public.is_chair(p_session) or public.is_admin()) then
    raise exception 'Only the Defense Chair (or the Coordinator) can control the timer';
  end if;
  select * into s from public.defense_sessions where id = p_session for update;
  if s.id is null then raise exception 'Defense not found'; end if;
  if s.is_locked then raise exception 'This defense is locked'; end if;

  t := coalesce(s.timer, jsonb_build_object(
    'phases', '[{"label":"Presentation","minutes":20},{"label":"Q&A","minutes":20},{"label":"Deliberation","minutes":15}]'::jsonb,
    'phase', 0, 'running', false, 'started_at', null, 'elapsed', 0));
  n := jsonb_array_length(t->'phases');
  -- seconds used in the current part so far
  v_elapsed := coalesce((t->>'elapsed')::numeric, 0)
             + case when (t->>'running')::boolean and t->>'started_at' is not null
                    then extract(epoch from now() - (t->>'started_at')::timestamptz) else 0 end;

  if p_action = 'start' then
    t := t || jsonb_build_object('running', true, 'started_at', now());
  elsif p_action = 'pause' then
    t := t || jsonb_build_object('running', false, 'started_at', null, 'elapsed', round(v_elapsed));
  elsif p_action = 'next' then
    t := t || jsonb_build_object('phase', ((t->>'phase')::int + 1) % n, 'running', false, 'started_at', null, 'elapsed', 0);
  elsif p_action = 'reset' then
    t := t || jsonb_build_object('running', false, 'started_at', null, 'elapsed', 0);
  elsif p_action = 'configure' then
    if p_phases is null or jsonb_typeof(p_phases) <> 'array' or jsonb_array_length(p_phases) not between 1 and 6 then
      raise exception 'Set 1 to 6 parts';
    end if;
    for e in select * from jsonb_array_elements(p_phases) loop
      if coalesce(trim(e->>'label'), '') = '' or length(e->>'label') > 40 then raise exception 'Each part needs a name (up to 40 characters)'; end if;
      if (e->>'minutes') is null or (e->>'minutes')::numeric not between 1 and 180 or (e->>'minutes')::numeric <> floor((e->>'minutes')::numeric) then
        raise exception 'Minutes must be a whole number from 1 to 180';
      end if;
    end loop;
    ph := (select jsonb_agg(jsonb_build_object('label', trim(x->>'label'), 'minutes', (x->>'minutes')::int)) from jsonb_array_elements(p_phases) x);
    t := t || jsonb_build_object('phases', ph, 'phase', least((t->>'phase')::int, jsonb_array_length(ph) - 1),
                                 'running', false, 'started_at', null, 'elapsed', 0);
  else
    raise exception 'Unknown timer action';
  end if;

  update public.defense_sessions set timer = t where id = p_session;
  return t;
end $$;
revoke execute on function public.timer_action(uuid, text, jsonb) from public, anon;
grant execute on function public.timer_action(uuid, text, jsonb) to authenticated;
