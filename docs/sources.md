# Источники

- `docs/Тестовое задание. Full stack.md` — исходные обязательные контракты.
- `docs/tz.md` — сверенные требования и уточнения заказчика (CRM, LLM-провайдер, источник транскрипта).
- `docs/main_task.md` — постановка: Clean Architecture с use case-файлами, приоритеты.
- Принятые решения — `docs/decisions.md`, `ASSUMPTIONS.md`.
- Martin Fowler, Repository — repository как collection-like persistence abstraction с набором операций: https://martinfowler.com/eaaCatalog/repository.html
- Microsoft Learn, Repository/persistence design — repository связан с aggregate и содержит необходимые persistence methods: https://learn.microsoft.com/dotnet/architecture/microservices/microservice-ddd-cqrs-patterns/infrastructure-persistence-layer-design
- NestJS SSE — event id/type/data и lifecycle SSE connection: https://docs.nestjs.com/techniques/server-sent-events

Внешние источники помогают выбрать форму реализации, но не переопределяют контракт тестового задания.
