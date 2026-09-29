# Сервис управления обзвоном

Тестовое задание на NestJS + TypeScript + PostgreSQL 16. На текущем этапе **P0 реализован**: ядро обзвона, tenant isolation, webhook processing и CRM outbox. P1 (анализ звонка + SSE + React UI) ещё не реализован.

## Что готово в P0

- `POST /rpc/claim_next_contact` с JWT HS256 и атомарным SQL claim через `FOR UPDATE SKIP LOCKED`.
- PostgreSQL RLS с tenant context из подписанного JWT, а не доверенного `SET org_id`.
- `POST /webhooks/calls` с HMAC-SHA256 raw body, dedup, bigint `sequence`, out-of-order protection и first-terminal-wins.
- DB trigger для contact counters/DNC и transactional CRM outbox.
- CRM worker с lease, timeout, bounded exponential retry и `dead` state.
- structured request logs + correlation id, `/healthz`, `/readyz`.
- минимальные unit tests и один integration smoke для P0 invariants.

Подробный scope/AC/DoD: `docs/p0-plan.md`. План следующих фаз: `docs/progress.md`.

## Запуск P0

```bash
cp .env.example .env
# укажите WEBHOOK_SECRET, JWT_SECRET, CRM_URL, PROVIDER_URL

docker compose up -d --build

The migration service is built as its own image, so migration scripts are copied into the container and do not depend on host bind mounts.
```

Контракт:

- API: `http://localhost:8080`
- `GET /healthz` → 200
- `GET /readyz` → 200 при доступной БД
- PostgreSQL: `postgresql://postgres:postgres@localhost:54329/postgres`
- миграции применяются автоматически сервисом `migrate`

`PROVIDER_URL` пока не используется P0, но остаётся обязательной переменной исходного задания для совместимости следующей фазы.

## JWT для локальной проверки

После установки dependencies:

```bash
corepack pnpm install
JWT_SECRET=dev-jwt-secret corepack pnpm jwt:generate -- --org-id <uuid> --sub worker-1 --role worker
```

Поддерживаемые роли: `worker`, `authenticated`.

## Проверки

```bash
corepack pnpm typecheck
corepack pnpm build
corepack pnpm test:p0
corepack pnpm test:p0:integration
```

Integration smoke предполагает уже запущенный `docker compose` и проверяет RLS, concurrent claim, HMAC, unknown call, duplicate/out-of-order events, terminal side effects и one-row outbox.

## Структура

- `app/backend` — P0 backend.
- `migrations` — PostgreSQL schema/functions/triggers/RLS.
- `scripts` — migrations/bootstrap runtime settings.
- `docs/Тестовое задание. Full stack.md` — исходное задание, не изменено по смыслу.
- `docs/tz.md`, `docs/architecture.md`, `docs/database.md`, `docs/p0-plan.md` — согласованная реализация.
- `.codex/agents` — инструкции агентов для продолжения с P1.

## Не входит в P0

Analysis provider, SSE journal/API и React UI — это P1. Нагрузочные цели 2 млн contacts / 5–20 workers / 50 rps webhooks будут считаться достигнутыми только после измерений P2.
