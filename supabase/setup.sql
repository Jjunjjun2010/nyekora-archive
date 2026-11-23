-- Nyekora Archive: Supabase 설정 (한 번만 실행)
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 전부 붙여 넣고 Run.
-- 여러 번 실행해도 안전합니다(이미 있으면 건너뛰거나 다시 맞춤).
--
-- 표 구성
--   1) public.nyekora_archive : 기록관 편집 내용(계정 하나당 행 하나)
--   2) public.village_chats   : 마을 NPC 대화 기록 + 장기 기억(NPC 하나당 행 하나)

-- =========================================================
-- 1) 기록관 편집 내용
-- =========================================================
create table if not exists public.nyekora_archive (
  owner_id   uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,
  version    integer     not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.nyekora_archive enable row level security;

drop policy if exists "nyekora_archive_select_own" on public.nyekora_archive;
create policy "nyekora_archive_select_own" on public.nyekora_archive
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_archive_insert_own" on public.nyekora_archive;
create policy "nyekora_archive_insert_own" on public.nyekora_archive
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_archive_update_own" on public.nyekora_archive;
create policy "nyekora_archive_update_own" on public.nyekora_archive
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke all on public.nyekora_archive from anon;
revoke all on public.nyekora_archive from authenticated;
grant select, insert, update on public.nyekora_archive to authenticated;

-- =========================================================
-- 2) 마을 NPC 대화 기록 + 장기 기억
--    messages: [{ id, speaker, role, name, text, createdAt, refs }]
--    memory  : { summary, facts[], lastSummarizedAt, summarizedCount }
-- =========================================================
create table if not exists public.village_chats (
  owner_id   uuid        not null references auth.users (id) on delete cascade,
  npc_id     text        not null default 'ruwata',
  messages   jsonb       not null default '[]'::jsonb,
  memory     jsonb       not null default '{}'::jsonb,
  version    integer     not null default 1,
  updated_at timestamptz not null default now(),
  primary key (owner_id, npc_id)
);

alter table public.village_chats enable row level security;

drop policy if exists "village_chats_select_own" on public.village_chats;
create policy "village_chats_select_own" on public.village_chats
  for select to authenticated
  using ((select auth.uid()) = owner_id);

drop policy if exists "village_chats_insert_own" on public.village_chats;
create policy "village_chats_insert_own" on public.village_chats
  for insert to authenticated
  with check ((select auth.uid()) = owner_id);

drop policy if exists "village_chats_update_own" on public.village_chats;
create policy "village_chats_update_own" on public.village_chats
  for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

revoke all on public.village_chats from anon;
revoke all on public.village_chats from authenticated;
grant select, insert, update on public.village_chats to authenticated;

-- 참고: 두 표 모두 로그인하지 않은 방문자(anon)는 접근할 수 없습니다.
--       실제 데이터 접근 권한은 위 Row Level Security 규칙이 담당합니다.
