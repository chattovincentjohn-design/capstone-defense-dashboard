-- Pre-launch tuning from the Supabase performance advisor.

-- Indexes for foreign keys used in joins and cascades
create index if not exists defense_minutes_recorder_id_idx on public.defense_minutes (recorder_id);
create index if not exists defense_sessions_secretary_id_idx on public.defense_sessions (secretary_id);
create index if not exists panel_comments_panel_assignment_id_idx on public.panel_comments (panel_assignment_id);
create index if not exists panel_comments_resolved_by_idx on public.panel_comments (resolved_by);
create index if not exists project_members_user_id_idx on public.project_members (user_id);
create index if not exists rubric_scores_criterion_id_idx on public.rubric_scores (criterion_id);
create index if not exists rubric_scores_student_id_idx on public.rubric_scores (student_id);

-- Evaluate auth.uid() once per query instead of once per row (same rules as before)
drop policy users_self on public.users;
create policy users_self on public.users for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy minutes_insert on public.defense_minutes;
create policy minutes_insert on public.defense_minutes for insert to authenticated
  with check (public.is_secretary(session_id) and recorder_id = (select auth.uid()));
