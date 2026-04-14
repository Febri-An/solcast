-- Run in Supabase SQL Editor (or supabase db push) before using the app.
-- Profiles: keyed by Solana wallet address (base58).

create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  wallet_address text primary key,
  username text unique,
  avatar_url text,
  updated_at timestamptz not null default now()
);

create index if not exists profiles_username_lower on public.profiles (lower(username));

alter table public.profiles enable row level security;

-- Public read (anon + authenticated) for displaying usernames/avatars.
create policy "profiles_select_public"
  on public.profiles
  for select
  to anon, authenticated
  using (true);

-- No direct inserts/updates/deletes from clients; mutations go through Next.js API + service role.
create policy "profiles_no_insert_anon"
  on public.profiles
  for insert
  to anon
  with check (false);

create policy "profiles_no_update_anon"
  on public.profiles
  for update
  to anon
  using (false);

create policy "profiles_no_delete_anon"
  on public.profiles
  for delete
  to anon
  using (false);

create policy "profiles_no_insert_authenticated"
  on public.profiles
  for insert
  to authenticated
  with check (false);

create policy "profiles_no_update_authenticated"
  on public.profiles
  for update
  to authenticated
  using (false);

create policy "profiles_no_delete_authenticated"
  on public.profiles
  for delete
  to authenticated
  using (false);

-- Storage: public bucket for avatar URLs; uploads only via service role (API routes).
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Allow public read of objects in avatars bucket.
create policy "avatars_public_read"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'avatars');

-- Deny direct uploads from clients (service role bypasses RLS).
create policy "avatars_no_insert_anon"
  on storage.objects
  for insert
  to anon
  with check (false);

create policy "avatars_no_update_anon"
  on storage.objects
  for update
  to anon
  using (false);

create policy "avatars_no_delete_anon"
  on storage.objects
  for delete
  to anon
  using (false);
