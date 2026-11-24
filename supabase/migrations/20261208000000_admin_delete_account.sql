-- Permanently delete an account. Refused for people who appear on defense records
-- (panel seats, minutes, resolved revisions, adviser or secretary of a group/defense):
-- disable those instead so names on signed documents stay intact.
create or replace function public.admin_delete_account(p_user uuid) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can delete accounts'; end if;
  if p_user = auth.uid() then raise exception 'You cannot delete your own account'; end if;
  if not public.can_manage_account(p_user) then raise exception 'Only the Super Admin can manage Coordinator accounts'; end if;
  if not exists (select 1 from public.users where id = p_user) then raise exception 'Account not found'; end if;
  if exists (select 1 from public.panel_assignments where faculty_id = p_user)
     or exists (select 1 from public.defense_minutes where recorder_id = p_user)
     or exists (select 1 from public.panel_comments where resolved_by = p_user)
     or exists (select 1 from public.capstone_projects where adviser_id = p_user)
     or exists (select 1 from public.defense_sessions where secretary_id = p_user) then
    raise exception 'This person appears on defense records (panel, adviser, secretary or minutes). Disable the account instead so those records stay complete.';
  end if;
  delete from auth.users where id = p_user;   -- the profile is removed with it
end $$;

revoke execute on function public.admin_delete_account(uuid) from public, anon;
grant execute on function public.admin_delete_account(uuid) to authenticated;
