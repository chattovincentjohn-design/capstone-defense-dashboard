-- Which panel seats have started scoring — without revealing any scores.
-- Blind grading hides in-progress scores even from the Coordinator, but the UI
-- still needs to know which seats are locked (can't be removed/reassigned) and
-- whether a session's rubric/blend is frozen. Returns rows only to people who
-- can already see the session.
create or replace function public.panel_scoring_status(p_session uuid)
returns table (assignment_id uuid, has_scores boolean)
language sql stable security definer set search_path = public as $$
  select a.id, exists (select 1 from public.rubric_scores r where r.panel_assignment_id = a.id)
    from public.panel_assignments a
   where a.session_id = p_session and public.can_view_session(p_session)
$$;
revoke execute on function public.panel_scoring_status(uuid) from public, anon;
grant execute on function public.panel_scoring_status(uuid) to authenticated;
