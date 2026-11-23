-- =============================================================================
-- Account management for the Capstone Coordinator, without a service-role key.
-- Every function checks public.is_admin(); helpers live in a schema that the
-- API does not expose.
-- =============================================================================

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- 12 random characters as xxxx-xxxx-xxxx (no look-alike characters)
create or replace function private.temp_password() returns text
language plpgsql volatile set search_path = extensions, pg_catalog as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(12);
  out text := '';
begin
  for i in 0..11 loop
    out := out || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    if i in (3, 7) then out := out || '-'; end if;
  end loop;
  return out;
end $$;

-- All accounts with sign-in status (admins only; others get no rows)
create or replace function public.admin_list_accounts()
returns table (id uuid, email text, full_name text, role public.user_role, department text,
               created_at timestamptz, last_sign_in_at timestamptz, is_active boolean)
language sql stable security definer set search_path = public, auth as $$
  select u.id, u.email, u.full_name, u.role, u.department, u.created_at, a.last_sign_in_at,
         (a.banned_until is null or a.banned_until <= now())
    from public.users u join auth.users a on a.id = u.id
   where public.is_admin()
   order by u.full_name
$$;

-- Create a confirmed email/password account; returns the temporary password once.
create or replace function public.admin_create_account(
  p_email text, p_full_name text, p_role public.user_role, p_department text
) returns table (user_id uuid, temp_password text)
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(p_email));
  v_name text := trim(p_full_name);
  v_pw text := private.temp_password();
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can create accounts'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if v_name = '' then raise exception 'Full name is required'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(v_pw, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v_name),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', null, now(), now());

  -- handle_new_user() created the profile; set role and details
  update public.users
     set role = p_role, full_name = v_name, department = nullif(trim(coalesce(p_department, '')), '')
   where id = v_id;

  return query select v_id, v_pw;
end $$;

-- New temporary password; signs the person out of every device.
create or replace function public.admin_reset_password(p_user uuid) returns text
language plpgsql security definer set search_path = public, auth, extensions as $$
declare v_pw text := private.temp_password();
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can reset passwords'; end if;
  update auth.users set encrypted_password = crypt(v_pw, gen_salt('bf')), updated_at = now() where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  delete from auth.sessions where user_id = p_user;
  return v_pw;
end $$;

-- Disable / re-enable sign-in. Records (scores, minutes, signatures) are kept.
create or replace function public.admin_set_account_active(p_user uuid, p_active boolean) returns void
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then raise exception 'Only the Capstone Coordinator can change account status'; end if;
  if p_user = auth.uid() and not p_active then raise exception 'You cannot disable your own account'; end if;
  update auth.users
     set banned_until = case when p_active then null else now() + interval '100 years' end, updated_at = now()
   where id = p_user;
  if not found then raise exception 'Account not found'; end if;
  if not p_active then delete from auth.sessions where user_id = p_user; end if;
end $$;

-- Coordinators cannot remove their own admin role (avoids locking everyone out).
create or replace function public.protect_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and not public.is_admin()
     and (new.role is distinct from old.role or new.email is distinct from old.email) then
    raise exception 'Only admins can change role or email';
  end if;
  if old.id = auth.uid() and old.role = 'admin' and new.role <> 'admin' then
    raise exception 'You cannot remove your own Coordinator role';
  end if;
  return new;
end $$;

revoke execute on function private.temp_password() from public, anon, authenticated;
revoke execute on function public.protect_user_role() from public, anon, authenticated;
revoke execute on function
  public.admin_list_accounts(), public.admin_create_account(text, text, public.user_role, text),
  public.admin_reset_password(uuid), public.admin_set_account_active(uuid, boolean)
from public, anon;
grant execute on function
  public.admin_list_accounts(), public.admin_create_account(text, text, public.user_role, text),
  public.admin_reset_password(uuid), public.admin_set_account_active(uuid, boolean)
to authenticated;
