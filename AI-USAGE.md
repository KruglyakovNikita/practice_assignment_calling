# Использование ИИ

- ChatGPT/Codex использованы для аудита ТЗ, проектирования и реализации P0/P1 backend, SQL, contracts, UI, targeted tests и документации.
- Исходное ТЗ и ответы заказчика сохранены; дополнительные решения фиксируются в `ASSUMPTIONS.md` и `docs/decisions.md`.
- P0 усилен signed-JWT RLS, raw-body HMAC, bigint sequence, duplicate/out-of-order state machine и transactional CRM outbox.
- P1 реализован как persisted PostgreSQL job/journal: one-analysis-per-attempt, provider SSE, Retry-After, timeout/cancel/crash recovery, Last-Event-ID replay и React fetch-SSE UI.
- Общая Zod-схема результата вынесена в `packages/contracts`; server/client validation не дублируется.
- Архитектурное правило уточнено: один use case = один публичный `execute()`, repository может иметь несколько cohesion-связанных persistence methods.
- Тесты добавлены только для critical paths: P0 core, transcript/SSE parser/invalid done и P1 integration retry/replay/tenant/fallback/partial/cancel.
- В среде реализации Docker отсутствует, npm registry недоступен. Не заявляется фактический compose/integration run; выполнены source/static syntax checks и подготовлены команды полного прогона.
