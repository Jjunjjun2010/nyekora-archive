-- Nyekora Archive: 알림 관련 테이블 + 원자적 클레임 RPC
-- 실행: Supabase 대시보드 → SQL Editor → New query → 이 파일 내용을 전부 붙여 넣고 Run.
--
-- 안전 원칙
--   * 기존 테이블/발송 기록을 삭제하지 않습니다. (DROP TABLE / DROP COLUMN 없음)
--   * create table if not exists / add column if not exists / do 블록으로 재실행 안전.
--   * nyekora_archive 테이블은 전혀 건드리지 않습니다.
--
-- 이번 수정 반영
--   1) nyekora_mark_sent / nyekora_mark_error 의 WHERE 에 digest_key 조건 추가
--   2) nyekora_claim_settings: error 상태는 lease 만료 전까지 재클레임 금지
--      (만료 전 결과 상태 'error_cooldown' 반환, 만료 후 새 claim_token 발급)
--   3) SECURITY DEFINER: search_path 고정 + auth.uid()/auth.role() 검증 + PUBLIC 권한 회수
--      (cron 등 service_role 호출은 auth.role()='service_role' 로 통과)

-- =========================================================
-- 1) nyekora_notify_settings: 사용자별 알림 설정
-- =========================================================
create table if not exists public.nyekora_notify_settings (
  owner_id    uuid        not null references auth.users (id) on delete cascade,
  enabled     boolean     not null default true,
  mode        text        not null default 'manual', -- manual | daily | weekly | off
  recipient_email text    null,
  send_hour   integer     not null default 9,
  day_of_week text,
  timezone    text        not null default 'Asia/Seoul',
  top_n       integer     not null default 5,
  dedup_days  integer     not null default 1,
  last_sent_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint nyekora_notify_settings_owner_key unique (owner_id)
);

alter table public.nyekora_notify_settings enable row level security;

drop policy if exists "nyekora_notify_settings_select_own" on public.nyekora_notify_settings;
create policy "nyekora_notify_settings_select_own" on public.nyekora_notify_settings
  for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_notify_settings_insert_own" on public.nyekora_notify_settings;
create policy "nyekora_notify_settings_insert_own" on public.nyekora_notify_settings
  for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_notify_settings_update_own" on public.nyekora_notify_settings;
create policy "nyekora_notify_settings_update_own" on public.nyekora_notify_settings
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_notify_settings_delete_own" on public.nyekora_notify_settings;
create policy "nyekora_notify_settings_delete_own" on public.nyekora_notify_settings
  for delete to authenticated using ((select auth.uid()) = owner_id);

-- =========================================================
-- 2) nyekora_notify_snapshot: 브라우저가 계산한 우선순위 결과
-- =========================================================
create table if not exists public.nyekora_notify_snapshot (
  owner_id   uuid        not null references auth.users (id) on delete cascade,
  snapshot   jsonb       not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  source_updated_at timestamptz not null default now(),
  constraint nyekora_notify_snapshot_owner_key unique (owner_id)
);

alter table public.nyekora_notify_snapshot enable row level security;

drop policy if exists "nyekora_notify_snapshot_select_own" on public.nyekora_notify_snapshot;
create policy "nyekora_notify_snapshot_select_own" on public.nyekora_notify_snapshot
  for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_notify_snapshot_insert_own" on public.nyekora_notify_snapshot;
create policy "nyekora_notify_snapshot_insert_own" on public.nyekora_notify_snapshot
  for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_notify_snapshot_update_own" on public.nyekora_notify_snapshot;
create policy "nyekora_notify_snapshot_update_own" on public.nyekora_notify_snapshot
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- =========================================================
-- 3) nyekora_notify_sent: 설정+발송기간 단위 클레임/중복 방지 상태
--    (digest_key 단위 1행. status: available | claimed | sent | error)
-- =========================================================
create table if not exists public.nyekora_notify_sent (
  owner_id      uuid        not null references auth.users (id) on delete cascade,
  digest_key    text        not null,
  status        text        not null default 'available'
                  check (status in ('available', 'claimed', 'sent', 'error')),
  claim_token   uuid,
  claimed_at    timestamptz,
  lease_timeout timestamptz,
  send_count    integer     not null default 0,
  last_sent_at  timestamptz,
  item_ids      jsonb       not null default '[]'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint nyekora_notify_sent_pk primary key (owner_id, digest_key)
);

-- 3-1) (구버전 스키마가 이미 존재하는 경우) 데이터 보존형 마이그레이션
--      구버전: primary key(owner_id, item_id), digest_key/status/claim_token 등 없음
do $$
declare
  v_has_item_id     boolean;
  v_has_digest_key  boolean;
  v_pk_name         text;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nyekora_notify_sent' and column_name = 'item_id'
  ) into v_has_item_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'nyekora_notify_sent' and column_name = 'digest_key'
  ) into v_has_digest_key;

  if v_has_item_id and not v_has_digest_key then
    -- 새 컬럼 추가 (기존 행/값 삭제 없음)
    alter table public.nyekora_notify_sent
      add column if not exists digest_key text,
      add column if not exists status text default 'available',
      add column if not exists claim_token uuid,
      add column if not exists claimed_at timestamptz,
      add column if not exists lease_timeout timestamptz,
      add column if not exists item_ids jsonb default '[]'::jsonb,
      add column if not exists created_at timestamptz default now(),
      add column if not exists updated_at timestamptz default now();

    -- 레거시 행의 digest_key 채우기 (삭제 없이 보존)
    update public.nyekora_notify_sent
       set digest_key = 'legacy:' || item_id
     where digest_key is null;

    -- 구 PK(owner_id, item_id) 제거 → 새 PK(owner_id, digest_key)로 교체
    select conname into v_pk_name
      from pg_constraint
     where conrelid = 'public.nyekora_notify_sent'::regclass and contype = 'p';
    if v_pk_name is not null then
      execute format('alter table public.nyekora_notify_sent drop constraint %I', v_pk_name);
    end if;

    -- item_id는 더 이상 PK가 아니므로 NOT NULL 해제(레거시 값 보존)
    alter table public.nyekora_notify_sent alter column item_id drop not null;

    -- 레거시 발송 기록은 'sent'로 표기
    update public.nyekora_notify_sent set status = 'sent' where status is null or status = 'available';

    -- 새 컬럼 제약 정리
    alter table public.nyekora_notify_sent alter column digest_key set not null;
    alter table public.nyekora_notify_sent alter column status set not null;
    alter table public.nyekora_notify_sent alter column status set default 'available';

    -- 새 PK 추가
    alter table public.nyekora_notify_sent
      add constraint nyekora_notify_sent_pk primary key (owner_id, digest_key);
  end if;
end $$;

alter table public.nyekora_notify_sent enable row level security;

drop policy if exists "nyekora_notify_sent_select_own" on public.nyekora_notify_sent;
create policy "nyekora_notify_sent_select_own" on public.nyekora_notify_sent
  for select to authenticated using ((select auth.uid()) = owner_id);

-- 인덱스 (조회/만료 청소 최적화)
create index if not exists idx_nyekora_notify_sent_status on public.nyekora_notify_sent (status);
create index if not exists idx_nyekora_notify_sent_lease on public.nyekora_notify_sent (lease_timeout)
  where status in ('claimed', 'error');

-- =========================================================
-- 4) nyekora_notify_log: 발송 이력 (digest_key 단위 1행, upsert 사용)
-- =========================================================
create table if not exists public.nyekora_notify_log (
  id         bigint generated always as identity primary key,
  owner_id   uuid        not null references auth.users (id) on delete cascade,
  "trigger"  text        not null,
  digest_key text        not null,
  item_ids   jsonb       not null default '[]'::jsonb,
  status     text        not null default 'sending',
  message_id text,
  error      text,
  created_at timestamptz not null default now(),
  unique (owner_id, digest_key)
);

alter table public.nyekora_notify_log enable row level security;

drop policy if exists "nyekora_notify_log_select_own" on public.nyekora_notify_log;
create policy "nyekora_notify_log_select_own" on public.nyekora_notify_log
  for select to authenticated using ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_notify_log_insert_own" on public.nyekora_notify_log;
create policy "nyekora_notify_log_insert_own" on public.nyekora_notify_log
  for insert to authenticated with check ((select auth.uid()) = owner_id);

drop policy if exists "nyekora_notify_log_update_own" on public.nyekora_notify_log;
create policy "nyekora_notify_log_update_own" on public.nyekora_notify_log
  for update to authenticated using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

-- =========================================================
-- 5) 테이블 권한 (anon 차단, authenticated 최소 권한)
-- =========================================================
revoke all on public.nyekora_notify_settings from anon;
revoke all on public.nyekora_notify_snapshot from anon;
revoke all on public.nyekora_notify_sent from anon;
revoke all on public.nyekora_notify_log from anon;

grant select, insert, update, delete on public.nyekora_notify_settings to authenticated;
grant select, insert, update on public.nyekora_notify_snapshot to authenticated;
grant select on public.nyekora_notify_sent to authenticated;            -- 상태는 RPC로만 변경
grant select, insert, update on public.nyekora_notify_log to authenticated;

-- =========================================================
-- 6) RPC: 원자적 클레임 (INSERT ... ON CONFLICT)
--    - 신규 INSERT 경합: ON CONFLICT 로 한 쪽만 INSERT, 다른 쪽은 UPDATE
--    - available: 즉시 클레임
--    - claimed(lease 유효): 다른 요청 소유 → 'claimed_by_other'
--    - claimed(lease 만료): 재클레임
--    - error(lease 유효): 재클레임 금지 → 'error_cooldown'
--    - error(lease 만료): 재클레임 + 새 claim_token
--    - sent: 재발송 금지 → 'sent'
-- =========================================================
create or replace function public.nyekora_claim_settings(
  p_owner_id   uuid,
  p_digest_key text
)
returns table (
  result_status text,
  claim_token   uuid,
  claimed_at    timestamptz,
  lease_timeout timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_claim_token   uuid        := gen_random_uuid();
  v_now           timestamptz := now();
  v_lease_expires timestamptz := now() + interval '10 minutes';
  v_row           public.nyekora_notify_sent%rowtype;
begin
  -- 소유자 검증 (cron 등 service_role 은 허용)
  if (auth.uid() is distinct from p_owner_id)
     and (auth.role() is distinct from 'service_role') then
    raise exception '권한 없음: 자신의 데이터만 처리할 수 있습니다';
  end if;

  insert into public.nyekora_notify_sent as s (
    owner_id, digest_key, status, claim_token, claimed_at, lease_timeout, updated_at
  ) values (
    p_owner_id, p_digest_key, 'claimed', v_claim_token, v_now, v_lease_expires, v_now
  )
  on conflict (owner_id, digest_key) do update set
    status = case
      when s.status = 'sent' then s.status
      when s.status = 'claimed' and s.lease_timeout is not null and s.lease_timeout >= v_now then s.status
      when s.status = 'error'   and s.lease_timeout is not null and s.lease_timeout >= v_now then s.status
      else 'claimed'
    end,
    claim_token = case
      when s.status = 'sent' then s.claim_token
      when s.status = 'claimed' and s.lease_timeout is not null and s.lease_timeout >= v_now then s.claim_token
      when s.status = 'error'   and s.lease_timeout is not null and s.lease_timeout >= v_now then s.claim_token
      else v_claim_token
    end,
    claimed_at = case
      when s.status = 'sent' then s.claimed_at
      when s.status = 'claimed' and s.lease_timeout is not null and s.lease_timeout >= v_now then s.claimed_at
      when s.status = 'error'   and s.lease_timeout is not null and s.lease_timeout >= v_now then s.claimed_at
      else v_now
    end,
    lease_timeout = case
      when s.status = 'sent' then s.lease_timeout
      when s.status = 'claimed' and s.lease_timeout is not null and s.lease_timeout >= v_now then s.lease_timeout
      when s.status = 'error'   and s.lease_timeout is not null and s.lease_timeout >= v_now then s.lease_timeout
      else v_lease_expires
    end,
    updated_at = v_now
  returning * into v_row;

  if v_row.status = 'claimed' and v_row.claim_token = v_claim_token then
    return query select 'claimed'::text,         v_row.claim_token, v_row.claimed_at, v_row.lease_timeout;
  elsif v_row.status = 'sent' then
    return query select 'sent'::text,            v_row.claim_token, v_row.claimed_at, v_row.lease_timeout;
  elsif v_row.status = 'claimed' then
    return query select 'claimed_by_other'::text, v_row.claim_token, v_row.claimed_at, v_row.lease_timeout;
  elsif v_row.status = 'error' then
    return query select 'error_cooldown'::text,   v_row.claim_token, v_row.claimed_at, v_row.lease_timeout;
  else
    return query select 'available'::text,        v_row.claim_token, v_row.claimed_at, v_row.lease_timeout;
  end if;
end;
$$;

-- =========================================================
-- 7) RPC: 발송 성공 마킹 (owner_id + digest_key + claim_token + status 4조건)
--    성공한 claim_token 만 'sent'로 전환 → 이전 요청이 새 상태를 덮어쓰지 못함
-- =========================================================
create or replace function public.nyekora_mark_sent(
  p_owner_id    uuid,
  p_digest_key  text,
  p_claim_token uuid,
  p_item_ids    jsonb default '[]'::jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_row public.nyekora_notify_sent%rowtype;
begin
  if (auth.uid() is distinct from p_owner_id)
     and (auth.role() is distinct from 'service_role') then
    raise exception '권한 없음: 자신의 데이터만 처리할 수 있습니다';
  end if;

  update public.nyekora_notify_sent
     set status        = 'sent',
         last_sent_at  = v_now,
         send_count    = send_count + 1,
         item_ids      = coalesce(p_item_ids, '[]'::jsonb),
         claim_token   = null,
         lease_timeout = null,
         updated_at    = v_now
   where owner_id    = p_owner_id
     and digest_key  = p_digest_key      -- FIX 1
     and claim_token = p_claim_token
     and status      = 'claimed'
  returning * into v_row;

  return found;
end;
$$;

-- =========================================================
-- 8) RPC: 발송 실패 마킹 (owner_id + digest_key + claim_token + status 4조건)
--    error 로 두고 lease 5분 부여 → 5분 뒤 재시도 허용
-- =========================================================
create or replace function public.nyekora_mark_error(
  p_owner_id    uuid,
  p_digest_key  text,
  p_claim_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_row public.nyekora_notify_sent%rowtype;
begin
  if (auth.uid() is distinct from p_owner_id)
     and (auth.role() is distinct from 'service_role') then
    raise exception '권한 없음: 자신의 데이터만 처리할 수 있습니다';
  end if;

  update public.nyekora_notify_sent
     set status        = 'error',
         lease_timeout = v_now + interval '5 minutes',
         updated_at    = v_now
   where owner_id    = p_owner_id
     and digest_key  = p_digest_key      -- FIX 1
     and claim_token = p_claim_token
     and status      = 'claimed'
  returning * into v_row;

  return found;
end;
$$;

-- =========================================================
-- 9) RPC: 만료 클레임 청소 (service_role 전용, cron 등에서 호출)
-- =========================================================
create or replace function public.nyekora_cleanup_expired_claims()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.nyekora_notify_sent
     set status = 'available', claim_token = null, claimed_at = null,
         lease_timeout = null, updated_at = now()
   where status in ('claimed', 'error')
     and lease_timeout is not null
     and lease_timeout < now() - interval '1 minute';

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =========================================================
-- 10) 함수 권한 (PUBLIC 회수, 필요한 역할에만 부여)
-- =========================================================
revoke all on function public.nyekora_claim_settings(uuid, text) from public;
grant execute on function public.nyekora_claim_settings(uuid, text) to authenticated, service_role;

revoke all on function public.nyekora_mark_sent(uuid, text, uuid, jsonb) from public;
grant execute on function public.nyekora_mark_sent(uuid, text, uuid, jsonb) to authenticated, service_role;

revoke all on function public.nyekora_mark_error(uuid, text, uuid) from public;
grant execute on function public.nyekora_mark_error(uuid, text, uuid) to authenticated, service_role;

revoke all on function public.nyekora_cleanup_expired_claims() from public;
revoke all on function public.nyekora_cleanup_expired_claims() from authenticated;
grant execute on function public.nyekora_cleanup_expired_claims() to service_role;

-- =========================================================
-- 11) Cron (선택): pg_cron 사용 시 1시간마다 gmail-digest?action=cron 호출
--     CRON_SECRET 은 SQL 에 하드코딩하지 말고 Vault/Dashboard 예약 설정 사용.
-- =========================================================
-- select cron.schedule('0 * * * *', $$
--   select net.http_post(
--     url := 'https://<project-ref>.functions.supabase.co/gmail-digest?action=cron',
--     headers := jsonb_build_object('x-cron-secret', '<CRON_SECRET>', 'content-type', 'application/json'),
--     body := '{}'::jsonb
--   );
-- $$);

-- 끝. nyekora_archive 및 기존 발송 기록은 삭제/변경하지 않았습니다.
