-- Coordinators (and the Super Admin for Coordinator accounts) can correct a person's
-- sign-in email. Updates the login record, the profile and any linked group member row.
create or replace function public.admin_change_email(p_user uuid, p_email text) returns void
language plpgsql security definer set search_path = public, auth as $$
declare v_email text := lower(trim(coalesce(p_email, '')));
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can change emails'; end if;
  if not public.can_manage_account(p_user) then raise exception 'Only the Super Admin can manage Coordinator accounts'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email and id <> p_user) then
    raise exception 'Another account already uses this email';
  end if;

  update auth.users
     set email = v_email, email_confirmed_at = coalesce(email_confirmed_at, now()),
         email_change = '', email_change_token_new = '', updated_at = now()
   where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  update auth.identities
     set identity_data = identity_data || jsonb_build_object('email', v_email), updated_at = now()
   where user_id = p_user and provider = 'email';
  update public.users set email = v_email where id = p_user;
  update public.project_members set email = v_email where user_id = p_user;
end $$;

revoke execute on function public.admin_change_email(uuid, text) from public, anon;
grant execute on function public.admin_change_email(uuid, text) to authenticated;
