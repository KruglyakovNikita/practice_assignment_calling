# Архитектура

P0 реализован. Архитектура остаётся минимальной Clean Architecture: adapters → application/use-cases → domain. SQL-функция claim и terminal trigger — намеренные DB-side исключения для атомарных правил задания.

## P0 structure

```text
app/backend/src/
  calls/domain
  calls/application/{ports,use-cases}
  calls/adapters/{http,sql}
  crm/application/{ports,use-cases}
  crm/adapters/{http,sql,cron}
  shared/{auth,config,database,http,logging}
  health
migrations/001_p0_core.sql
scripts/{apply-migrations.sh,bootstrap-roles.sql,sync-runtime-settings.sql}
```

## Потоки

**Claim.** HTTP JWT guard валидирует HS256 → adapter открывает tenant DB transaction → `SET LOCAL app.jwt` → SQL `claim_next_contact` повторно проверяет JWT внутри PostgreSQL через RLS context → campaign row lock + contact `FOR UPDATE SKIP LOCKED` → queued attempt с `provider_call_id=attempt_id::text`.

**Webhook.** Nest сохраняет raw body → HMAC guard → controller извлекает top-level `sequence` как bigint без JS number → service-role DB transaction блокирует attempt по `provider_call_id` → сохраняет уникальное событие → state reducer решает допустимый patch → update attempt. Terminal trigger в той же транзакции обновляет contact и создаёт outbox.

**CRM.** Worker периодически арендует bounded batch через `FOR UPDATE SKIP LOCKED`, коммитит lease, затем делает HTTP вне DB transaction. Success/failure фиксируются отдельным update по lease token; expired lease можно взять повторно. Доставка at-least-once, retry bounded, после лимита `dead`.

## Security/tenant model

- API JWT: HS256, `sub`, `org_id`, `role=worker|authenticated`.
- Tenant DB role не superuser и не BYPASSRLS. RLS извлекает `org_id` только из JWT, подпись которого проверяется SECURITY DEFINER функцией с secret в закрытой таблице `app_private.settings`.
- Простое `SET app.org_id` не существует как security boundary. `app.jwt` можно выставить, но поддельный JWT не проходит HMAC DB verification.
- Webhook/background используют отдельную `auto_calling_service` role: BYPASSRLS нужен для cross-tenant lookup, но DML grants ограничены `call_attempts`, `webhook_events`, `crm_outbox`. Postgres superuser остаётся только в migration service. Эти пути не принимают org_id из payload как authority.
- `public` schema CREATE отозван; SECURITY DEFINER функции имеют фиксированный `search_path`.

## State invariants

- Active: queued/dialing/in_progress. На contact максимум одна active attempt через partial unique index.
- Terminal: completed/failed/no_answer. Первый terminal status финален.
- `last_sequence` монотонно растёт. Старые события сохраняются, но не откатывают status. Late answered может заполнить пустой started_at.
- `provider_event_id` и `(provider_call_id, sequence)` уникальны.
- CRM side effects возникают только на nonterminal→terminal transition.

## P1 boundary

`call_attempts.transcript text NULL` уже присутствует, но analysis API/provider/SSE/UI не входят в P0. P1 не должен менять P0 state machine, tenant model или CRM transaction boundaries.
