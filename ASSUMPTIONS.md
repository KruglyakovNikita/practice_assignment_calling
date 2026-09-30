# Решения и допущения

Статус: P0 и P1 реализованы; следующий этап — P2 verification/load/finalization.

## P0

- `call_id` webhook сопоставляется только с сохранённым `provider_call_id`.
- Первый terminal status финален; stale sequence не откатывает state.
- CRM отделена transactional outbox, доставка at-least-once.
- Signed-JWT RLS остаётся tenant boundary; доверенного `SET org_id` нет.

## P1

- Analysis разрешён для `completed|failed|no_answer`: это terminal attempts, которые уже не изменят call lifecycle.
- Один analysis на `call_attempt_id`; повторный POST возвращает существующий status и не вызывает provider повторно.
- Transcript источник — `call_attempts.transcript`. NULL/empty/whitespace → `Транскрипт звонка отсутствует. Это тестовая заглушка.` только на provider boundary. Непустой текст передаётся без trim/изменения.
- Provider 429 retries выполняются только внутри первоначального worker execution и только по `Retry-After`; число retries ограничено env.
- После принятого SSE stream network/process failure не запускает новый provider request. С chunks итог `partial`, без chunks `error`.
- Invalid `done` → `error` даже если chunks уже были; chunks остаются в `partial_result`.
- Cancel queued завершается сразу. Cancel streaming помечается persisted flag и abort-ит request; cross-instance worker замечает flag heartbeat-ом.
- Analysis worker использует PostgreSQL queue/lease и concurrency cap. Redis/broker не нужен до доказанной P2 bottleneck.
- SSE journal хранится в PostgreSQL. Global bigint event id используется как стабильный SSE id; replay фильтрует `id > Last-Event-ID`.
- Browser использует `fetch` stream вместо native EventSource, чтобы отправлять Authorization и Last-Event-ID headers.

## Verification limitation

В текущей среде реализации отсутствуют Docker и доступ к npm registry. Выполнены source/static syntax checks; targeted unit/integration tests добавлены и должны быть прогнаны в обычной Docker/npm среде до финального P2 handoff.
