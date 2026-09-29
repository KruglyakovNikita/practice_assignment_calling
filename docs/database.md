# PostgreSQL 16 — фактическая P0 модель

Основная миграция: `migrations/001_p0_core.sql`. Имена и типы полей исходного задания сохранены; дополнительные поля нужны для correctness/recovery.

## Core

- `orgs(id,name)`
- `campaigns(id,org_id,name,status)` + tenant FK/unique
- `contacts(id,org_id,campaign_id,phone_e164,timezone,attempts_count,last_attempt_at,do_not_call)`
- `call_attempts(... fixed fields ..., transcript,last_sequence,correlation_id)`
- `webhook_events(... fixed fields ..., org_id,correlation_id)`
- `crm_outbox(id,attempt_id UNIQUE,org_id,payload,status,attempts,next_attempt_at,lease_until,lease_token,last_error,delivered_at,correlation_id,...)`

Composite FK не позволяют связать campaign/contact/attempt разных org. `provider_call_id` unique для non-null. Partial unique по `contact_id` запрещает две active attempts.

## Claim

`public.claim_next_contact(uuid)` выполняется под tenant role/RLS. Кампания блокируется `FOR SHARE`, contact выбирается `FOR UPDATE SKIP LOCKED`. Фильтры: active campaign, DNC=false, attempts<3, cooldown>=4h, local IANA time `[09:00,20:00)`, нет active attempt.

Timezone валидируется trigger-ом через `pg_timezone_names`, поэтому invalid IANA name не попадает в contacts даже при прямом INSERT.

## RLS

RLS включён и forced на tenant tables. Политики используют `(SELECT app_private.current_org_id())`, чтобы signed JWT context вычислялся один раз как initplan, а не HMAC на каждую строку. Secret хранится в `app_private.settings`; app role не имеет доступа к таблице.

## Webhook/terminal

Webhook transaction: attempt `FOR UPDATE` → event insert `ON CONFLICT DO NOTHING` → monotonic patch attempt. SQL bigint передаётся строкой, поэтому значения > `Number.MAX_SAFE_INTEGER` не теряют точность.

`call_attempts_terminal_effects` срабатывает только nonterminal→terminal: `attempts_count+1`, `last_attempt_at=ended_at`, boolean `outcome.do_not_call=true`, one-row CRM outbox.

## CRM outbox

Workers арендуют due/expired rows через `FOR UPDATE SKIP LOCKED`; network call выполняется после lease commit. `lease_token` защищает late worker completion. Status: pending/delivering/delivered/dead; retry exponential и bounded конфигом.

## Performance

P0 создаёт claim/outbox/event indexes, но p95/p99 не считаются доказанными без P2 load run. Нельзя заменять измерение предположением.
