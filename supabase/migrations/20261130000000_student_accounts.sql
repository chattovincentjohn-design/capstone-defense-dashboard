-- =============================================================================
-- Student (proponent) accounts: one per student, each sees only their own grade.
-- =============================================================================

-- Email per proponent, used to create and link their sign-in account.
alter table public.project_members add column if not exists email text;
create unique index if not exists project_members_project_email
  on public.project_members (project_id, lower(email)) where email is not null;

-- Is this proponent row the signed-in student?
create or replace function public.is_my_member(p_member uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.project_members where id = p_member and user_id = auth.uid())
$$;

-- Blind grading + student privacy:
--  * own scores: always
--  * after lock: admin, panel, secretary, adviser see everything;
--    a proponent sees group-level scores and ONLY their own individual scores
--  * chair: everything once all panelists submitted
--  * panelists: submitted colleagues' scores after their own submission
drop policy if exists scores_read on public.rubric_scores;
create policy scores_read on public.rubric_scores for select to authenticated using (
  public.owns_assignment(panel_assignment_id)
  or (public.session_locked(session_id) and (
        public.is_admin() or public.is_panelist(session_id) or public.is_secretary(session_id)
        or public.is_session_adviser(session_id)
        or (public.is_session_student(session_id) and (student_id is null or public.is_my_member(student_id)))))
  or (public.is_chair(session_id) and public.all_panel_submitted(session_id))
  or (public.is_panelist(session_id)
      and (public.my_assignment(session_id)).has_submitted
      and public.assignment_submitted(panel_assignment_id))
);

-- Membership is fixed once any defense of the group has scores
-- (removing a student would silently delete their scores; adding one would
-- make signed evaluations incomplete). Renames and emails stay editable.
create or replace function public.protect_scored_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.defense_sessions s join public.rubric_scores r on r.session_id = s.id
             where s.project_id = coalesce(new.project_id, old.project_id)) then
    raise exception 'Group membership is locked once scoring has started';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists project_members_protect on public.project_members;
create trigger project_members_protect before insert or delete on public.project_members
  for each row execute function public.protect_scored_members();

-- Create (or link) a proponent's sign-in account. Returns the temporary password
-- once, or null when an existing student account with that email was linked.
create or replace function public.admin_create_member_account(p_member uuid, p_email text default null)
returns table (user_id uuid, temp_password text, linked_existing boolean)
language plpgsql security definer set search_path = public, auth as $$
declare
  m public.project_members;
  v_email text;
  v_group text;
  v_existing uuid;
  v_existing_role public.user_role;
  v_new_id uuid;
  v_pw text;
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can create accounts'; end if;
  select * into m from public.project_members where id = p_member for update;
  if m.id is null then raise exception 'Member not found'; end if;
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

  select coalesce(group_label, 'Proponent') into v_group from public.capstone_projects where id = m.project_id;
  select c.user_id, c.temp_password into v_new_id, v_pw
    from public.admin_create_account(v_email, m.student_name, 'student', v_group) c;
  update public.project_members set user_id = v_new_id, email = v_email where id = p_member;
  return query select v_new_id, v_pw, false;
end $$;

revoke execute on function public.is_my_member(uuid) from public, anon;
grant execute on function public.is_my_member(uuid) to authenticated;
revoke execute on function public.protect_scored_members() from public, anon, authenticated;
revoke execute on function public.admin_create_member_account(uuid, text) from public, anon;
grant execute on function public.admin_create_member_account(uuid, text) to authenticated;
