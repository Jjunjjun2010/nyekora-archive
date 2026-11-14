-- Nyekora Archive: Supabase 설정 (한 번만 실행)
-- 사용법: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 전부 붙여 넣고 Run.
-- 여러 번 실행해도 안전합니다(이미 있으면 건너뛰거나 다시 맞춤).

-- 1) 내 편집 내용을 담는 표: 계정 하나당 행 하나
create table if not exists public.archive_docs (
  owner      uuid primary key references auth.users (id) on delete cascade,
  data       jsonb       not null,
  version    integer     not null default 1,
  updated_at timestamptz not null default now()
);

-- 2) 보안 켜기 (Row Level Security): 규칙에 맞는 행만 접근 가능
alter table public.archive_docs enable row level security;

-- 3) 규칙: 로그인한 "본인" 행만 읽기/쓰기. 삭제는 아예 허용하지 않음.
drop policy if exists "archive_docs_select_own" on public.archive_docs;
create policy "archive_docs_select_own" on public.archive_docs
  for select to authenticated
  using ((select auth.uid()) = owner);

drop policy if exists "archive_docs_insert_own" on public.archive_docs;
create policy "archive_docs_insert_own" on public.archive_docs
  for insert to authenticated
  with check ((select auth.uid()) = owner);

drop policy if exists "archive_docs_update_own" on public.archive_docs;
create policy "archive_docs_update_own" on public.archive_docs
  for update to authenticated
  using ((select auth.uid()) = owner)
  with check ((select auth.uid()) = owner);

-- 4) 로그인하지 않은 방문자(anon)는 이 표에 접근 불가
revoke all on public.archive_docs from anon;
revoke all on public.archive_docs from authenticated;
grant select, insert, update on public.archive_docs to authenticated;
