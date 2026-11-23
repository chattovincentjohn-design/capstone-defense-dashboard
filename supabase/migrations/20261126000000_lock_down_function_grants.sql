-- =============================================================================
-- Function privileges (Supabase security advisor 0028 / 0029)
--  * Nothing is callable by signed-out visitors (anon).
--  * Trigger functions are not callable by anyone over the API (triggers still fire).
--  * Signed-in users keep the access-check helpers that RLS policies evaluate as
--    the caller, plus the RPCs, each of which checks permissions internally.
-- =============================================================================
revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

revoke execute on function
  public.handle_new_user(),
  public.protect_user_role(),
  public.validate_rubric_score(),
  public.block_when_locked(),
  public.snapshot_session_rubric(),
  public.protect_used_criteria(),
  public.protect_scored_session(),
  public.protect_scored_assignment(),
  public.stamp_session_blend()
from authenticated;

grant execute on function
  public.current_role_of(), public.is_admin(), public.my_assignment(uuid), public.is_panelist(uuid),
  public.is_chair(uuid), public.is_secretary(uuid), public.is_session_adviser(uuid), public.is_session_student(uuid),
  public.session_locked(uuid), public.all_panel_submitted(uuid), public.assignment_submitted(uuid),
  public.owns_assignment(uuid), public.can_view_session(uuid), public.can_view_project(uuid),
  public.criterion_is_frozen(uuid),
  public.submit_evaluation(uuid), public.finalize_defense(uuid, public.defense_verdict),
  public.resolve_revision(uuid, boolean, text, text), public.sync_session_rubric(uuid),
  public.revise_criterion(uuid, text, text, numeric, numeric, int)
to authenticated;
