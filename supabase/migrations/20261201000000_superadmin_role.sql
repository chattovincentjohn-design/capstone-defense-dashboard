-- A Super Admin sits above the Capstone Coordinator. (Enum values must be committed
-- before they are used, so this lives in its own migration.)
alter type public.user_role add value if not exists 'superadmin';
