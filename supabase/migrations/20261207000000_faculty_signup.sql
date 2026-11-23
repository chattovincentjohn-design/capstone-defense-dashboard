-- Faculty self sign-up: faculty create their own account (choosing their own password)
-- on the public /signup page with a faculty code from the Coordinator. Only non-admin
-- roles can be chosen; the code is separate from the group registration code.

alter table public.registration_settings
  add column faculty_open boolean not null default false,
  add column faculty_code text not null default '';

-- Let faculty_signup() set the chosen (non-admin) role on the brand-new profile.
create or replace function public.protect_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.faculty_signup', true) = 'on'
     and old.role = 'panelist' and new.role in ('panelist', 'chair', 'secretary', 'adviser')
     and new.email is not distinct from old.email then
    return new;
  end if;
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

create or replace function public.faculty_signup_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.registration_settings;
begin
  select * into s from public.registration_settings where id = 1;
  if s.id is null or not s.faculty_open or s.faculty_code = '' then
    return jsonb_build_object('open', false, 'valid', false);
  end if;
  return jsonb_build_object('open', true,
    'valid', lower(trim(coalesce(p_code, ''))) = lower(trim(s.faculty_code)));
end $$;

create or replace function public.faculty_signup(
  p_code text, p_full_name text, p_email text, p_password text, p_role public.user_role, p_department text
) returns uuid
language plpgsql security definer set search_path = public, auth, extensions as $$
declare
  s public.registration_settings;
  v_id uuid := gen_random_uuid();
  v_email text := lower(trim(coalesce(p_email, '')));
  v_name text := trim(coalesce(p_full_name, ''));
  v_dept text := nullif(trim(coalesce(p_department, '')), '');
begin
  select * into s from public.registration_settings where id = 1;
  if s.id is null or not s.faculty_open or s.faculty_code = '' then raise exception 'Faculty sign-up is closed.'; end if;
  if lower(trim(coalesce(p_code, ''))) <> lower(trim(s.faculty_code)) then raise exception 'The faculty sign-up code is incorrect.'; end if;
  if p_role is null or p_role not in ('panelist', 'chair', 'secretary', 'adviser') then raise exception 'Choose Panel Member, Defense Chair, Defense Secretary or Adviser.'; end if;
  if length(v_name) not between 3 and 120 then raise exception 'Enter your full name.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 254 then raise exception 'Enter a valid email address.'; end if;
  if length(coalesce(p_password, '')) not between 8 and 72 then raise exception 'Password must be 8 to 72 characters.'; end if;
  if length(coalesce(v_dept, '')) > 120 then raise exception 'Department is too long.'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Use "Forgot password" on the sign-in page.';
  end if;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', v_name),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', null, now(), now());

  -- handle_new_user() created the profile as Panel Member; apply the chosen role and details
  perform set_config('app.faculty_signup', 'on', true);
  update public.users set role = p_role, full_name = v_name, department = v_dept where id = v_id;
  perform set_config('app.faculty_signup', 'off', true);
  return v_id;
end $$;

revoke execute on function public.faculty_signup_info(text),
  public.faculty_signup(text, text, text, text, public.user_role, text) from public;
grant execute on function public.faculty_signup_info(text),
  public.faculty_signup(text, text, text, text, public.user_role, text) to anon, authenticated;
