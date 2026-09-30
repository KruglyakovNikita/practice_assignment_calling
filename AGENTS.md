# Сервис управления обзвоном — инструкции Codex

P0, P1 и P2 выполнены (`docs/performance.md`); P0/P1 invariants менять только при доказанной ошибке.

## Source of truth

Читать: `docs/progress.md`, `docs/tz.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/database.md`, `ASSUMPTIONS.md`, `docs/code-style.md`, `docs/performance.md`. Исходники задания и ответы заказчика не менять по смыслу.

`.claude/` и `CLAUDE.md` — архив, не действующие инструкции.

## P0 invariants

- SQL `claim_next_contact` + `SKIP LOCKED`; одна active attempt на contact.
- Signed-JWT forced RLS; не заменять на доверенный `SET org_id`.
- Webhook raw-body HMAC, bigint sequence, duplicate/out-of-order, first-terminal-wins.
- Terminal side effects + CRM outbox атомарны; CRM HTTP вне webhook transaction.

## P1 invariants

- Один analysis на call attempt; repeat POST не вызывает provider снова.
- Transcript берётся из `call_attempts.transcript`; blank/null fallback только на provider boundary.
- Provider 429 — только bounded Retry-After retries до начала stream.
- После начала stream auto-regeneration запрещён. Break/timeout с chunks → partial, без chunks → error; invalid done → error.
- Cancel сохраняет chunks. Expired worker lease завершает job partial/error/cancelled, а не requeue.
- `analysis_events` — persisted SSE journal; stable id + Last-Event-ID continuation.
- Общая result schema только в `packages/contracts`.
- UI root `data-state` должен различать idle/queued/streaming/reconnecting/partial/error/cancelled/completed.
- JWT/secrets/transcript/full provider payload не логировать.

## Architecture/style

Clean Architecture: adapters → application/use-cases → domain. Один use case-класс = один публичный `execute()`. Private helpers допустимы. Repository/port может иметь несколько связанных persistence methods; не дробить на класс на каждый SQL.

P2 performance claims отмечать только после измерения. Не добавлять Redis/broker без подтверждённого bottleneck.
