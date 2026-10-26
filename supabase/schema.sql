-- Voxlbuilder workshop: run this once in your Supabase project (SQL Editor → New query → paste → Run).
--
-- Visitors (the public "anon" key) can only READ visible builds. They never write the tables directly:
-- publishing, liking and deleting go through the functions below, which validate input and limit spam.
-- To moderate, open Table Editor → builds and tick `hidden` (or delete the row).

create extension if not exists pgcrypto with schema extensions;

-- ------------------------------------------------------------------ tables
create table if not exists public.builds (
  id          text primary key,
  created_at  timestamptz not null default now(),
  title       text not null check (char_length(title) between 3 and 60),
  author      text not null check (char_length(author) between 1 and 30),
  description text not null default '' check (char_length(description) <= 1000),
  tags        text[] not null default '{}' check (cardinality(tags) <= 8),
  code        text not null check (char_length(code) between 10 and 8000),  -- the share code ("c=…")
  race        text,
  guild       text,
  weapon      text,
  art         text,
  level       int,
  likes       int not null default 0,
  hidden      boolean not null default false,  -- moderation: hidden builds disappear from the site
  edit_hash   text not null,                   -- sha256 of the publisher's secret delete token
  ip_hash     text                             -- for the per-connection publish limit
);
create index if not exists builds_likes_idx on public.builds (likes desc, created_at desc);
create index if not exists builds_created_idx on public.builds (created_at desc);
create index if not exists builds_tags_idx on public.builds using gin (tags);

create table if not exists public.build_likes (
  build_id   text not null references public.builds (id) on delete cascade,
  ip_hash    text not null,
  created_at timestamptz not null default now(),
  primary key (build_id, ip_hash)  -- one like per connection per build
);

-- ------------------------------------------------------------------ access
alter table public.builds enable row level security;
alter table public.build_likes enable row level security;

drop policy if exists "read visible builds" on public.builds;
create policy "read visible builds" on public.builds for select to anon, authenticated using (not hidden);

-- the public key may read only these columns (not edit_hash, ip_hash or hidden), and may not write at all
revoke all on public.builds from anon, authenticated;
revoke all on public.build_likes from anon, authenticated;
grant select (id, created_at, title, author, description, tags, code, race, guild, weapon, art, level, likes)
  on public.builds to anon, authenticated;

-- ------------------------------------------------------------------ helpers
create or replace function public.voxl_client_hash() returns text
language sql stable as $$
  select encode(extensions.digest(coalesce(
    split_part(coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''), ',', 1),
    'unknown') || ':voxlbuilder', 'sha256'), 'hex');
$$;

-- ------------------------------------------------------------------ publish
create or replace function public.publish_build(
  p_title text, p_author text, p_description text, p_tags text[], p_code text,
  p_race text, p_guild text, p_weapon text, p_art text, p_level int, p_edit_hash text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_ip   text := public.voxl_client_hash();
  v_id   text;
  v_tags text[];
begin
  if (select count(*) from public.builds where ip_hash = v_ip and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'You published 5 builds in the last hour. Try again later.';
  end if;
  if p_code !~ '^[bc]=[A-Za-z0-9_-]+$' then raise exception 'Invalid build code.'; end if;
  if p_edit_hash !~ '^[0-9a-f]{64}$' then raise exception 'Invalid edit token.'; end if;
  select coalesce(array_agg(distinct t), '{}') into v_tags
    from (select lower(left(btrim(x), 20)) as t from unnest(coalesce(p_tags, '{}')) as x) s
    where t ~ '^[a-z0-9][a-z0-9 +-]*$';
  v_tags := v_tags[1:8];
  v_id := substr(translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', 'xyz'), 1, 10);
  insert into public.builds (id, title, author, description, tags, code, race, guild, weapon, art, level, edit_hash, ip_hash)
  values (v_id, btrim(p_title), coalesce(nullif(btrim(p_author), ''), 'Anonymous'), coalesce(btrim(p_description), ''), v_tags, p_code,
          left(p_race, 40), left(p_guild, 40), left(p_weapon, 40), left(p_art, 40), least(greatest(coalesce(p_level, 80), 1), 80),
          p_edit_hash, v_ip);
  return v_id;
end $$;

-- ------------------------------------------------------------------ likes
create or replace function public.like_build(p_id text, p_like boolean default true) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_ip    text := public.voxl_client_hash();
  v_likes int;
begin
  if p_like then
    insert into public.build_likes (build_id, ip_hash) values (p_id, v_ip) on conflict do nothing;
  else
    delete from public.build_likes where build_id = p_id and ip_hash = v_ip;
  end if;
  update public.builds set likes = (select count(*) from public.build_likes where build_id = p_id)
    where id = p_id returning likes into v_likes;
  return coalesce(v_likes, 0);
end $$;

-- ------------------------------------------------------------------ delete your own build
create or replace function public.delete_build(p_id text, p_token text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  delete from public.builds
    where id = p_id and edit_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  return found;
end $$;

revoke all on function public.publish_build, public.like_build, public.delete_build, public.voxl_client_hash from public;
grant execute on function public.publish_build, public.like_build, public.delete_build to anon, authenticated;
