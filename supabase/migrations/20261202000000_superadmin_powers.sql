-- Super Admin: everything a Coordinator can do, plus sole control over Coordinator
-- (and Super Admin) accounts. Coordinators keep managing every other account.

create or replace function public.is_superadmin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'superadmin' from public.users where id = auth.uid()), false)
$$;

-- Coordinator powers now include the Super Admin
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'superadmin') from public.users where id = auth.uid()), false)
$$;

-- May the caller manage (reset, disable, edit, delete) this account?
create or replace function public.can_manage_account(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_superadmin() or p_user = auth.uid()
      or (public.is_admin()
          and coalesce((select role not in ('admin', 'superadmin') from public.users where id = p_user), true))
$$;

create or replace function public.protect_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon') then
    if not public.is_admin()
       and (new.role is distinct from old.role or new.email is distinct from old.email) then
      raise exception 'Only admins can change role or email';
    end if;
    if new.role is distinct from old.role and not public.is_superadmin()
       and (old.role in ('admin', 'superadmin') or new.role in ('admin', 'superadmin')) then
      raise exception 'Only the Super Admin can give or remove Coordinator access';
    end if;
    if old.role in ('admin', 'superadmin') and old.id is distinct from auth.uid() and not public.is_superadmin()
       and (new.full_name, new.department, new.email) is distinct from (old.full_name, old.department, old.email) then
      raise exception 'Only the Super Admin can manage Coordinator accounts';
    end if;
  end if;
  if old.id = auth.uid() and old.role in ('admin', 'superadmin') and new.role is distinct from old.role then
    raise exception 'You cannot change your own administrator role';
  end if;
  return new;
end $$;

drop policy users_admin on public.users;
create policy users_admin on public.users for all to authenticated
  using (public.is_admin() and public.can_manage_account(id))
  with check (public.is_admin());

create or replace function public.admin_reset_password(p_user uuid) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_pw text := private.temp_password();
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can reset passwords'; end if;
  if not public.can_manage_account(p_user) then raise exception 'Only the Super Admin can manage Coordinator accounts'; end if;
  update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  delete from auth.sessions where user_id = p_user;
  return v_pw;
end $$;

create or replace function public.admin_set_account_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can change account status'; end if;
  if not public.can_manage_account(p_user) then raise exception 'Only the Super Admin can manage Coordinator accounts'; end if;
  if p_user = auth.uid() and not p_active then raise exception 'You cannot disable your own account'; end if;
  update auth.users
     set banned_until = case when p_active then null else now() + interval '100 years' end, updated_at = now()
   where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  if not p_active then delete from auth.sessions where user_id = p_user; end if;
end $$;

revoke execute on function public.is_superadmin(), public.can_manage_account(uuid) from public, anon;
grant execute on function public.is_superadmin(), public.can_manage_account(uuid) to authenticated;
