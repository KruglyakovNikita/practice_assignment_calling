# Решения

1. P0 = критическое ядро разделов 4–6.1; P1 = анализ/SSE/UI; P2 = нагрузка и финальная сдача.
2. PostgreSQL functions/triggers используются только там, где нужна атомарность: claim и terminal side effects.
3. Tenant isolation P0: low-privilege DB role + forced RLS; `org_id` берётся из HS256 JWT, подпись повторно валидируется в PostgreSQL. Произвольный `SET org_id` не является boundary.
4. Claim: campaign `FOR SHARE`, contact `FOR UPDATE SKIP LOCKED`, partial unique active attempt, local IANA window, 4h cooldown, max 3 attempts.
5. Новые attempts получают `provider_call_id=id::text`; webhook всегда ищет по сохранённому provider_call_id и поддерживает произвольные string ids стенда.
6. Webhook: raw-body HMAC, уникальность `provider_event_id` и `(provider_call_id,sequence)`, sequence хранится bigint без JS precision loss. Первый terminal status финален; stale events не откатывают status.
7. Terminal trigger атомарно обновляет contact и создаёт одну outbox row. CRM HTTP выполняется позже, вне DB transaction.
8. CRM delivery: DB lease + `SKIP LOCKED`, lease token, timeout, bounded exponential retry, `dead` после лимита; at-least-once допустим.
9. Не логировать JWT, secrets, transcript или full webhook payload. Correlation id проходит request → webhook_events/call_attempt → outbox.
10. `call_attempts.transcript text NULL` добавлен заранее для совместимости P1 по ответу заказчика; analysis endpoints ещё отсутствуют.
11. Redis/broker не добавляются: в текущем scope PostgreSQL queue/outbox достаточно и проще для тестового.
12. Performance SLA не объявляется достигнутым без реального load run в P2.
