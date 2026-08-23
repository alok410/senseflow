-- SenseFlow: two login numbers per account + secure admin number-change flow
-- Run this once in Supabase (SQL editor or `supabase db push`).

-- 1) Secondary phone number on a profile. Either number can receive OTP / log in.
alter table public.profiles
  add column if not exists phone_secondary text;

create index if not exists profiles_phone_secondary_idx
  on public.profiles (phone_secondary);

-- 2) Number-change requests (admin accounts change their number via OTP:
--    OTP to the OLD number first, then OTP to the NEW number).
--    Written only by the server (service role), so no client policies are needed.
create table if not exists public.phone_change_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null,
  stage         text not null,            -- 'old' (verify current number) | 'new' (confirm new number)
  target_phone  text not null,            -- the number the OTP was sent to
  new_phone     text,                     -- the requested new number (set on the 'old' stage)
  code_hash     text not null,
  attempts      integer not null default 0,
  expires_at    timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists phone_change_requests_user_idx
  on public.phone_change_requests (user_id);

alter table public.phone_change_requests enable row level security;
-- No permissive policies on purpose: only the service-role server key may read/write.
