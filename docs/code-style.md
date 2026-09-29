# Стиль и примеры

Обязателен для всех исполнителей и ревьюеров. Не усложнять тестовое ради архитектурной полноты.

- TypeScript strict. Без any и необоснованных type assertions; неизвестный вход — unknown и runtime validation.
- Имена `type` и `interface` — lower camelCase (`callAttempt`, `callAttemptRepository`) по просьбе пользователя. type для union/данных, interface для портов; не дублировать одно определение двумя формами. Классы и React-компоненты — PascalCase; функции/поля — camelCase; файлы — kebab-case.
- Имена внешнего HTTP/SQL контракта (`call_attempt_id`, `org_id`) сохранять. На границе адаптера явно преобразовывать в camelCase.
- Domain/application не импортируют NestJS, pg, React или HTTP-клиенты. Один use case-файл на сценарий, без универсального Service на весь модуль.
- Shared по назначению: calculation — чистые вычисления, schemas — переиспользуемая валидация, http — транспорт. Не складывать всё в utils.ts и не создавать папки заранее.
- Общая схема финального анализа — packages/contracts; frontend и backend импортируют её, а не копируют.
- Комментарии только объясняют неочевидную причину/инвариант. Не добавлять многострочные пересказы кода и JSDoc для очевидных методов.
- Переиспользовать небольшие компоненты frontend/shared/ui и клиент frontend/shared/api, когда есть реальное повторное использование. Не строить дизайн-систему.
- Перед сквозной правкой найти затронутые типы, порты, DTO, SQL, UI и тесты. После — проверить все места. Не создавать абстракцию ради единственного простого вызова.

## Пример 1: use case и порт

```ts
export type claimContactCommand = { orgId: string; campaignId: string };
export type claimedContact = { id: string; phoneE164: string; attemptId: string };

export interface contactClaimPort {
  claim(command: claimContactCommand): Promise<claimedContact | null>;
}

export class ClaimNextContactUseCase {
  constructor(private readonly contacts: contactClaimPort) {}

  execute(command: claimContactCommand): Promise<claimedContact | null> {
    return this.contacts.claim(command);
  }
}
```

SQL-адаптер порта вызывает функцию БД. Use case не переносит SQL-фильтры и блокировки в JavaScript; Nest-модуль собирает экземпляр через provider factory.

## Пример 2: разделённый shared

```text
shared/calculation/retry-delay.ts
shared/schemas/webhook-event.schema.ts
shared/http/http-timeout.ts
```

```ts
export function retryDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** Math.min(attempt, 30), maxMs);
}
```

Входные параметры проверяет конфигурационный адаптер. Retry-After провайдера имеет приоритет над этой общей задержкой; чистая функция не читает env и не делает сетевых запросов.

## Пример 3: UI сохраняет частичный результат

```tsx
type analysisViewProps = {
  state: 'queued' | 'streaming' | 'reconnecting' | 'partial' | 'error' | 'cancelled' | 'completed';
  summary: string;
  onCancel: () => void;
};

export function AnalysisView({ state, summary, onCancel }: analysisViewProps) {
  const canCancel = state === 'queued' || state === 'streaming' || state === 'reconnecting';
  return (
    <section data-state={state}>
      <p>{summary}</p>
      <button disabled={!canCancel} onClick={onCancel}>Отменить анализ</button>
    </section>
  );
}
```

Это пример разделения ответственности, не полный UI. SSE/reconnect/накопление находятся в model/api, а не в компоненте отображения. При ошибке состояние меняется, summary не очищается.
