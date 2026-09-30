# Сервис управления обзвоном

Тестовое задание на NestJS + TypeScript + PostgreSQL 16 + React 18. Реализованы **P0 и P1**: ядро обзвона, tenant isolation, webhook/CRM outbox, persisted analysis jobs, provider SSE/replay/cancel и UI.

## Запуск

```bash
cp .env.example .env
docker compose up -d --build
```

После старта:
- API: `http://localhost:8080`
- UI: `http://localhost:5173`
- health: `GET /healthz`
- readiness: `GET /readyz`
- PostgreSQL: `postgresql://postgres:postgres@localhost:54329/postgres`
- миграции применяются автоматически (`001_p0_core.sql`, `002_p1_analysis.sql`)

## P0

- `POST /rpc/claim_next_contact`: signed-JWT tenant context, RLS, atomic `FOR UPDATE SKIP LOCKED` claim.
- `POST /webhooks/calls`: raw-body HMAC, bigint sequence, dedup/out-of-order, first-terminal-wins.
- terminal DB trigger + CRM transactional outbox.
- CRM worker: lease, timeout, bounded retry, dead-state.

## P1

API:

```text
POST /api/analyses            {"call_attempt_id":"uuid"}
GET  /api/analyses/:id
GET  /api/analyses/:id/stream
POST /api/analyses/:id/cancel
```

- один persisted analysis на `call_attempt_id`; repeat POST возвращает существующий status;
- analysis разрешён для terminal attempt;
- `call_attempts.transcript` → provider, blank/null → фиксированный fallback;
- provider SSE chunks сохраняются в `partial_result` и journal;
- final `done` валидируется одной схемой из `packages/contracts` на backend и frontend;
- 429 соблюдает `Retry-After`, retry count bounded;
- break/timeout после chunks → `partial`, до chunks → `error`; invalid done → `error`;
- cancel сохраняет уже полученные chunks;
- worker crash не вызывает provider повторно: expired lease переводится в partial/error/cancelled;
- SSE replay по persisted bigint id и `Last-Event-ID`;
- React UI использует Bearer Authorization для fetch-SSE и имеет `data-state`:
  `idle|queued|streaming|reconnecting|partial|error|cancelled|completed`.

## Локальный provider mock

Для ручной проверки P1 на хосте:

```bash
node scripts/mock-analysis-provider.mjs
```

По умолчанию `.env.example` указывает `PROVIDER_URL=http://host.docker.internal:18082`, поэтому Docker API на Windows/macOS увидит mock на хосте.

## JWT

```bash
corepack pnpm install
JWT_SECRET=dev-jwt-secret corepack pnpm jwt:generate -- --org-id <uuid> --sub user-1 --role authenticated
```

## Проверки

```bash
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:p0
corepack pnpm test:p0:integration
corepack pnpm test:p1
corepack pnpm test:p1:integration
```

P1 integration suite проверяет retry, один analysis, persisted SSE replay, tenant isolation, transcript fallback, partial, crash recovery и cancel. Для integration tests нужен запущенный compose; P1 suite также поднимает provider mock на host port `18082`.

## Архитектура

- `app/backend/src/*/application/use-cases` — один публичный `execute()` на прикладной сценарий.
- repositories/ports могут иметь несколько связанных persistence-методов; они не являются use cases.
- `packages/contracts` — общий Zod contract результата анализа.
- `app/web` — одна React-страница из раздела 7.4.
- PostgreSQL остаётся очередью/journal до P2 measurements; Redis/broker без доказанной необходимости не добавлен.

Подробности: `docs/architecture.md`, `docs/database.md`, `docs/decisions.md`, `docs/progress.md`, `docs/p1-completion.md`.
