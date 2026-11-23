-- Role/email changes: block API callers (signed-in or anonymous) who are not admins,
-- but allow trusted contexts with no end-user JWT (SQL editor, service role, migrations).
create or replace function public.protect_user_role() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(auth.role(), '') in ('authenticated', 'anon')
     and not public.is_admin()
     and (new.role is distinct from old.role or new.email is distinct from old.email) then
    raise exception 'Only admins can change role or email';
  end if;
  return new;
end $$;
revoke execute on function public.protect_user_role() from public, anon, authenticated;
