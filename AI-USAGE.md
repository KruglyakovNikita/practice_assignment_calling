# Использование ИИ

- ChatGPT/Codex использованы для аудита ТЗ, уточнения архитектуры, подготовки P0 plan и реализации P0 backend/SQL/tests/docs.
- Исходное задание и ответы заказчика сохранены. Решения, не заданные напрямую, вынесены в `ASSUMPTIONS.md`/`docs/decisions.md`.
- После аудита отдельно усилены: signed-JWT RLS context, HMAC raw-body verification, bigint sequence, duplicate/out-of-order state machine, transactional outbox, lease/retry/dead-state и correlation id.
- Добавлены только критические P0 tests: state/security/retry unit tests и один DB/API integration smoke.
- В текущей рабочей среде npm registry и Docker/PostgreSQL недоступны, поэтому dependencies/build/integration не приписываются как запущенные. Выполнена локальная статическая проверка исходников; команды полного прогона находятся в README.
