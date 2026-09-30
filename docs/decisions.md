# Решения

1. P0 = критическое ядро; P1 = analysis/SSE/UI; P2 = нагрузка и финальная сдача.
2. PostgreSQL functions/triggers используются только для атомарных P0 правил: claim и terminal side effects.
3. Tenant isolation: low-privilege DB role + forced RLS; `org_id` берётся из HS256 JWT, подпись повторно проверяется в PostgreSQL.
4. Claim: campaign `FOR SHARE`, contact `FOR UPDATE SKIP LOCKED`, partial unique active attempt, local IANA window, cooldown/max attempts.
5. Webhook: raw-body HMAC, bigint sequence без JS precision loss, dedup/out-of-order, first-terminal-wins.
6. CRM: transactional outbox; network вне webhook transaction; lease + bounded retry/dead.
7. Use case = один публичный сценарий/`execute()`. Private steps того же сценария допустимы. Repository может иметь несколько cohesion-связанных persistence methods; не дробится по одному SQL-вызову.
8. Analysis создаётся только для terminal call attempt; `UNIQUE(call_attempt_id)` гарантирует один analysis. Повторный POST не генерирует заново.
9. Transcript берётся из `call_attempts.transcript`; NULL/blank/whitespace заменяется фиксированным fallback только при provider request, исходное поле не переписывается.
10. Analysis processing — PostgreSQL persisted queue с `SKIP LOCKED` lease. Broker/Redis не добавляется до измеренной необходимости.
11. 429 повторяется только по `Retry-After` и bounded max retries. После начала SSE auto-restart generation запрещён.
12. Provider stream break/timeout с chunks → partial; без chunks → error. Invalid `done` всегда → error, накопленные chunks сохраняются.
13. Cancel queued сразу terminal; cancel streaming выставляет `cancel_requested` и abort-ит локальный fetch. Другой worker увидит cancel на heartbeat.
14. Streaming lease expiry означает process interruption: recovery завершает analysis partial/error/cancelled и не вызывает provider повторно.
15. SSE journal persisted в `analysis_events`; DB id — стабильный SSE id, chunk payload содержит тот же id; `Last-Event-ID` читает только продолжение.
16. UI использует fetch-based SSE из-за Bearer Authorization/Last-Event-ID. Native EventSource не является обязательной частью решения.
17. Общий `analysisResultSchema` живёт в `packages/contracts` и валидирует финал на backend и frontend.
18. Не логировать JWT, secrets, transcript или full provider/webhook payload.
19. Performance SLA считается достигнутым только после P2 load run.
