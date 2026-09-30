# Решения

1. P0 = критическое ядро; P1 = analysis/SSE/UI; P2 = нагрузка и финальная сдача.
2. PostgreSQL functions/triggers используются только для атомарных P0 правил: claim и terminal side effects.
3. Tenant isolation: low-privilege DB role + forced RLS; `org_id` берётся из HS256 JWT, подпись повторно проверяется в PostgreSQL.
4. Claim: `SECURITY DEFINER`-функция с одной проверкой JWT, маркер `contacts.active_attempt_id` + partial unique active attempt, индексная проба `FOR UPDATE SKIP LOCKED` на каждую таймзону кампании в окне, cooldown/max attempts.
5. Webhook: raw-body HMAC, bigint sequence без JS precision loss, dedup/out-of-order, first-terminal-wins.
6. CRM: transactional outbox; network вне webhook transaction; lease + bounded retry/dead.
7. Use case = один публичный сценарий/`execute()`. Private steps того же сценария допустимы. Repository может иметь несколько cohesion-связанных persistence methods; не дробится по одному SQL-вызову.
8. Analysis создаётся только для terminal call attempt; `UNIQUE(call_attempt_id)` гарантирует один analysis. Повторный POST не генерирует заново.
9. Transcript берётся из `call_attempts.transcript`; NULL/blank/whitespace заменяется фиксированным fallback только при provider request, исходное поле не переписывается.
10. Analysis processing — PostgreSQL persisted queue с `SKIP LOCKED` lease. Broker/Redis не добавляется до измеренной необходимости.
11. 429 повторяется только по `Retry-After` и bounded max retries. После начала SSE auto-restart generation запрещён.
12. Provider stream break/timeout с chunks → partial; без chunks → error. Invalid `done` всегда → error, накопленные chunks сохраняются.
13. Cancel queued сразу terminal; cancel streaming выставляет `cancel_requested` и abort-ит локальный fetch. Другой worker увидит cancel на heartbeat.
14. Прерванный разбор (lease истёк или graceful stop): поток провайдера не начинался — обратно в очередь; начинался — partial/error/cancelled без повторного вызова провайдера.
15. SSE journal persisted в `analysis_events`; DB id — стабильный SSE id, chunk payload содержит тот же id; `Last-Event-ID` читает только продолжение.
16. UI использует fetch-based SSE из-за Bearer Authorization/Last-Event-ID. Native EventSource не является обязательной частью решения.
17. Общий `analysisResultSchema` живёт в `packages/contracts` и валидирует финал на backend и frontend.
18. Не логировать JWT, secrets, transcript или full provider/webhook payload.
19. Performance SLA подтверждается только измерением (`docs/performance.md`).
20. Graceful shutdown: воркеры дожидаются начатой работы, SSE закрываются, пулы БД закрываются после HTTP. CRM — at-least-once с `Idempotency-Key`.
21. `/dev/*` и dev-блоки UI — только при `DEV_TOOLS=true`.
