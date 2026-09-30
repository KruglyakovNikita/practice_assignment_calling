# PostgreSQL 16 — фактическая модель P0 + P1

Миграции: `001_p0_core.sql`, `002_p1_analysis.sql`, `003_p1_claim_lock_grant.sql`, `004_p2_claim_performance.sql`.

## P2 (004)

- `app_private.timezones` — снимок `pg_timezone_names` для быстрой валидации IANA-зоны.
- `contacts.active_attempt_id` — маркер незавершённой попытки, ведётся триггерами `call_attempts`.
- `contacts_claim_ready_idx (campaign_id, timezone, coalesce(last_attempt_at,-inf), id)` partial `WHERE do_not_call=false AND attempts_count<3 AND active_attempt_id IS NULL`; старый `contacts_claim_lookup_idx` удалён.
- `claim_next_contact` — `SECURITY DEFINER`, loose index scan по зонам кампании + проба `SKIP LOCKED` на зону.
- Defaults `gen_random_uuid()` для id; `SELECT` на `webhook_events` для сервисной роли.

## P0 core

- `orgs`
- `campaigns`
- `contacts`
- `call_attempts` + nullable `transcript`
- `webhook_events`
- `crm_outbox`

P0 сохраняет signed-JWT RLS, atomic claim, first-terminal-wins и transactional CRM outbox.

## P1 analyses

`analyses`:
- `id`, `org_id`, `call_attempt_id UNIQUE`
- `status`: queued/streaming/completed/partial/error/cancelled
- `partial_result jsonb`, `result jsonb`
- `error_code`, `error_message`, `cancel_requested`
- `provider_started_at`, `lease_until`, `lease_token`
- timestamps

`analysis_events`:
- global monotonic `id bigint identity`
- `analysis_id`, `org_id`
- `event_type`: chunk/done/error
- `payload`, `created_at`

Composite `(call_attempt_id,org_id)` FK не позволяет analysis ссылаться на attempt другой организации. `(analysis_id,org_id)` делает то же для journal.

## Analysis concurrency/recovery

- `UNIQUE(call_attempt_id)` = один analysis на attempt даже при concurrent POST.
- Worker claim: queued row `FOR UPDATE SKIP LOCKED` → streaming + lease token.
- Любой worker write требует текущий lease token; stale worker после recovery не может дописать chunk/done.
- Heartbeat продлевает lease. Expired streaming job становится partial/error/cancelled и не генерируется повторно.
- Chunk update `partial_result` + event insert выполняются одной DB transaction.
- Completion/error/cancel + terminal SSE event также выполняются одной transaction.

## SSE replay

`analysis_events_replay_idx(analysis_id,id)` обслуживает replay. Клиентский `Last-Event-ID=N` читает только `id>N`, поэтому reconnect не повторяет provider generation.

## RLS/grants

Forced RLS включён на `analyses` и `analysis_events`. `auto_calling_app` видит только org из signed JWT context. `auto_calling_service` используется worker-ом cross-tenant, но получает только нужные SELECT/UPDATE/INSERT grants.

## Performance

P1 DB polling/journal намеренно остаются на PostgreSQL без Redis/broker. Фактические p95/p99 и необходимость LISTEN/NOTIFY или отдельной очереди решаются только после P2 measurements.
