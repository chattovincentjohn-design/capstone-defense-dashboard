-- New role for people who manage every course (programs). Separate migration because
-- a new enum value can't be used in the same transaction that adds it.
alter type public.user_role add value if not exists 'superadmin';
