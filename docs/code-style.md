# Стиль и примеры

Обязателен для всех исполнителей и ревьюеров. Не усложнять тестовое ради архитектурной полноты.

- TypeScript strict. Без `any` и необоснованных type assertions; неизвестный вход — `unknown` и runtime validation.
- Имена `type` и `interface` — lower camelCase по просьбе пользователя. Классы/React-компоненты — PascalCase; функции/поля — camelCase; файлы — kebab-case.
- Имена внешнего HTTP/SQL контракта (`call_attempt_id`, `org_id`) сохранять. На границе адаптера преобразовывать в camelCase.
- Domain/application не импортируют NestJS, `pg`, React или конкретные HTTP-клиенты.
- Один use case-класс представляет один прикладной сценарий и имеет один публичный `execute()`. Private helpers внутри use case допустимы, если это части того же сценария.
- Repository не является use case. Один repository/port может иметь несколько связанных persistence-методов для одного агрегата/job store; не создавать отдельный класс на каждый SQL-запрос.
- Controller может иметь несколько route handlers одного ресурса; бизнес-правила остаются в use cases/domain.
- Shared по назначению: calculation/schemas/http. Не создавать `utils.ts` как свалку.
- Общая схема финального анализа — `packages/contracts`; frontend и backend импортируют её, а не копируют.
- Комментарии только для неочевидного инварианта, максимум коротко.
- Frontend: SSE/reconnect/накопление состояния находятся в model/api, отображение — в React-компонентах.
- Перед сквозной правкой найти затронутые типы, порты, DTO, SQL, UI и тесты. Не создавать абстракцию ради единственного простого вызова.

## Use case

```ts
export class CreateAnalysisUseCase {
  constructor(private readonly analyses: analysisStorePort) {}

  execute(input: createAnalysisCommand): Promise<analysisState> {
    return this.analyses.createOrGet(input);
  }
}
```

Один публичный сценарий. Retry, validation и небольшие private helpers могут оставаться внутри, если не являются самостоятельными действиями внешнего актора.

## Repository

```ts
export interface analysisStorePort {
  createOrGet(...): Promise<...>;
  findById(...): Promise<...>;
  requestCancel(...): Promise<...>;
  listEventsAfter(...): Promise<...>;
}
```

Это корректный repository-style port: методы относятся к одному persisted analysis aggregate/journal. Делить его на четыре класса только из-за числа методов не требуется.
