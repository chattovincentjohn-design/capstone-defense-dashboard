-- Group account self sign-up: a member of a group that has no account yet creates the
-- group's single account on /group-signup, proving membership with the group code from
-- the Coordinator plus their email and student number as listed in the group.

alter table public.registration_settings
  add column group_signup_open boolean not null default false,
  add column group_signup_code text not null default '';

-- Let the sign-up functions set the new profile's role (faculty roles or student).
create or replace function public.protect_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_setting('app.faculty_signup', true) = 'on'
     and old.role = 'panelist' and new.role in ('panelist', 'chair', 'secretary', 'adviser', 'student')
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

create or replace function public.group_signup_info(p_code text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare s public.registration_settings;
begin
  select * into s from public.registration_settings where id = 1;
  if s.id is null or not s.group_signup_open or s.group_signup_code = '' then
    return jsonb_build_object('open', false, 'valid', false);
  end if;
  return jsonb_build_object('open', true,
    'valid', lower(trim(coalesce(p_code, ''))) = lower(trim(s.group_signup_code)));
end $$;

-- Finds the caller's group from their email + student number; errors explain what is wrong.
create or replace function private.group_signup_member(p_code text, p_email text, p_student_number text)
returns public.project_members
language plpgsql stable security definer set search_path = public as $$
declare s public.registration_settings; m public.project_members; v_holder text;
begin
  select * into s from public.registration_settings where id = 1;
  if s.id is null or not s.group_signup_open or s.group_signup_code = '' then raise exception 'Group account sign-up is closed.'; end if;
  if lower(trim(coalesce(p_code, ''))) <> lower(trim(s.group_signup_code)) then raise exception 'The group sign-up code is incorrect.'; end if;
  select * into m from public.project_members
   where lower(email) = lower(trim(coalesce(p_email, ''))) and lower(trim(student_number)) = lower(trim(coalesce(p_student_number, '')))
   order by user_id nulls first limit 1;
  if m.id is null then
    raise exception 'No group member matches that email and student number. Check them with your Coordinator.';
  end if;
  select x.student_name into v_holder from public.project_members x where x.project_id = m.project_id and x.user_id is not null limit 1;
  if v_holder is not null then
    raise exception 'Your group already has its account (held by %). Use that account, or ask the Coordinator.', v_holder;
  end if;
  return m;
end $$;
revoke execute on function private.group_signup_member(text, text, text) from public, anon, authenticated;

create or replace function public.group_signup_lookup(p_code text, p_email text, p_student_number text) returns jsonb
language plpgsql stable security definer set search_path = public, private as $$
declare m public.project_members; p public.capstone_projects;
begin
  m := private.group_signup_member(p_code, p_email, p_student_number);
  select * into p from public.capstone_projects where id = m.project_id;
  return jsonb_build_object('student_name', m.student_name, 'group_label', p.group_label, 'title', p.title);
end $$;

create or replace function public.group_signup(p_code text, p_email text, p_student_number text, p_password text) returns uuid
language plpgsql security definer set search_path = public, auth, extensions, private as $$
declare
  m public.project_members;
  v_group text;
  v_email text := lower(trim(coalesce(p_email, '')));
  v_id uuid := gen_random_uuid();
begin
  m := private.group_signup_member(p_code, p_email, p_student_number);
  if length(coalesce(p_password, '')) not between 8 and 72 then raise exception 'Password must be 8 to 72 characters.'; end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'An account with this email already exists. Sign in instead, or use "Forgot password".';
  end if;
  select group_label into v_group from public.capstone_projects where id = m.project_id;

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
    confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated', v_email,
    crypt(p_password, gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, jsonb_build_object('full_name', m.student_name),
    now(), now(), '', '', '', '');
  insert into auth.identities (id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
  values (gen_random_uuid(), v_id, v_id::text,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', true), 'email', null, now(), now());

  perform set_config('app.faculty_signup', 'on', true);
  update public.users set role = 'student', full_name = m.student_name, department = v_group where id = v_id;
  perform set_config('app.faculty_signup', 'off', true);
  update public.project_members set user_id = v_id where id = m.id;
  return v_id;
end $$;

revoke execute on function public.group_signup_info(text), public.group_signup_lookup(text, text, text),
  public.group_signup(text, text, text, text) from public;
grant execute on function public.group_signup_info(text), public.group_signup_lookup(text, text, text),
  public.group_signup(text, text, text, text) to anon, authenticated;
