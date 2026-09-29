# P0 — критическое ядро обзвона

P0 закрывает разделы 4–6.1 исходного задания и создаёт безопасную основу для P1 (анализ звонка + SSE + UI). В P0 нет LLM-провайдера, анализа и React UI.

## Scope

1. Запускаемый backend-каркас: NestJS + TypeScript, PostgreSQL 16, Docker Compose, автоматические SQL-миграции, `/healthz` и `/readyz`.
2. Tenant isolation: JWT HS256 (`sub`, `org_id`, `role`), RLS для tenant-таблиц и DB-проверка подписанного JWT вместо доверия к произвольному `SET org_id`.
3. Атомарный `POST /rpc/claim_next_contact`: SQL-функция, `FOR UPDATE SKIP LOCKED`, active campaign, DNC, max 3 attempts, 4h cooldown, IANA local window `[09:00,20:00)`, одна активная попытка на контакт.
4. `POST /webhooks/calls`: HMAC-SHA256 raw body, lookup только по `provider_call_id`, дедупликация, bigint sequence без JS precision loss, устойчивость к duplicate/out-of-order событиям, первый terminal финален.
5. Terminal side effects: DB trigger обновляет contact и создаёт одну CRM outbox запись атомарно.
6. CRM delivery: lease-based DB outbox, `SKIP LOCKED`, сеть вне DB-транзакции, bounded exponential retry, timeout и dead-state.
7. Correlation/operations: безопасные структурированные request logs, correlation id в webhook/event/outbox, health/readiness.
8. Только необходимые тесты: pure state/security/retry tests и один P0 integration smoke на реальной DB/API.

## Acceptance criteria

- Параллельный claim одного контакта выдаёт его только одному worker и создаёт ровно одну active attempt.
- Claim другой организации не видит и не меняет чужие данные; RLS не открывается простой подменой custom GUC без валидного JWT.
- `provider_call_id` для новых attempts равен строке `attempt_id`, но произвольные provider ids из стенда поддерживаются.
- Неверный HMAC → 401; неизвестный `call_id` → 404 `CALL_NOT_FOUND`; событие неизвестного звонка не сохраняется.
- Повтор одного webhook не применяет side effects повторно. Старый sequence не откатывает статус; terminal→любое следующее событие не меняет terminal status; late answered может заполнить `started_at`.
- Первый terminal transition увеличивает `attempts_count` один раз, выставляет `last_attempt_at`, применяет boolean `outcome.do_not_call=true`, создаёт одну CRM outbox запись.
- CRM недоступна/медленна — webhook commit и HTTP response не ждут CRM network call; retry ограничен и восстанавливается после истечения lease.
- JWT/secret/transcript/full webhook payload не попадают в request logs.

## Definition of Done

- Код, SQL и Docker-конфигурация P0 находятся в репозитории; документация отражает реальное состояние.
- `typecheck/build`, unit P0 и integration P0 smoke проходят в среде с установленными npm dependencies, Docker и PostgreSQL 16.
- `docker compose up -d --build` после `.env` поднимает DB → migrations → API; `GET /healthz` и `/readyz` возвращают 200.
- Нет P0-critical TODO/FIXME. Неизмеренные performance targets не помечаются выполненными до отдельного load run.

## После P0

P1 реализует раздел 7: `call_attempts.transcript` fallback, один analysis на attempt, provider SSE/429/retry/cancel/partial/error, persisted event log + Last-Event-ID и React UI. P2 — обязательный performance run на 2 млн contacts/5–20 workers/50 rps webhooks, финальная совместимость стенда и сдача.
