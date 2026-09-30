# Сервис управления обзвоном

NestJS + TypeScript + PostgreSQL 16 + React 18 (Vite, Tailwind). Реализованы обе части задания: ядро обзвона (разделы 4–6.1) и разбор звонка со стримингом и UI (раздел 7). Нагрузочные цели измерены, результаты — в `docs/performance.md`.

## Запуск

```bash
cp .env.example .env        # или свой .env с WEBHOOK_SECRET, JWT_SECRET, CRM_URL, PROVIDER_URL
docker compose up -d
```

| Что | Где |
|---|---|
| HTTP API | `http://localhost:8080` |
| Health-check | `GET /healthz` → 200 (`GET /readyz` дополнительно проверяет БД) |
| UI | `http://localhost:5173` |
| PostgreSQL | `postgresql://postgres:postgres@localhost:54329/postgres` |
| Миграции | сервис `migrate` применяет `migrations/*.sql` до старта API |

- Из `.env` обязательны только 4 переменные стенда, остальное имеет значения по умолчанию. Новый `JWT_SECRET` подхватывается при следующем `up`.
- `CRM_URL`/`PROVIDER_URL` могут указывать за пределы docker-сети (для хоста — `host.docker.internal`).
- Старт с нуля (чистая копия, `.env` из 4 строк): все сервисы healthy за ~37 с на собранных образах; сборка образов без кэша — ещё ~4 мин. Данные при старте не заливаются, миграции идут ~9 с.
- Первичный `initdb` идёт с `--no-sync` (на HDD с fsync он занимал ~3 мин); работающий сервер остаётся с `fsync=on`. У healthcheck БД `start_period: 300s` — запас для медленных машин.

### Ручная проверка всего флоу через UI

```bash
DEV_TOOLS=true PROVIDER_URL=http://mock-provider:18082 CRM_URL=http://mock-crm:18081 docker compose --profile mocks up -d --build
```

Откройте `http://localhost:5173`. В БД ходить не нужно:

1. **Подготовка** — «Создать демо-данные»: организация, активная кампания, 5 контактов в таймзоне, где сейчас рабочее время, и JWT. Там же форма «Выпустить JWT» (`org_id`, `sub`, `role`): например, токеном другой организации можно увидеть 404 на чужих разборах.
2. **Звонок** — «Получить контакт» (настоящий claim), затем кнопки событий `queued … no_answer`: сервер подписывает событие и шлёт в настоящий `POST /webhooks/calls`. Есть `do_not_call`, ручной `sequence` и «Повторить (дубль)». Раз в секунду показываются `call_attempts`, эффекты триггера, `webhook_events` и доставка в CRM.
3. **Разбор** — пресеты транскрипта (обычный, 429, обрыв, невалидный результат, бесконечный поток, пусто), запуск, отмена, «Разорвать SSE» (переподключение с `Last-Event-ID`) и журнал SSE-событий.

Заглушки профиля `mocks` (по умолчанию не поднимаются, сервис работает с любым `PROVIDER_URL`/`CRM_URL`):
- `mock-provider` — контракт 7.1; маркер в транскрипте выбирает поведение: `[429]`, `[break]`, `[invalid]`, `[slow]`.
- `mock-crm` — отвечает через `CRM_DELAY_MS` (1.5 с), отклоняет долю `CRM_FAIL_RATE` (30%) ответом 503.

`DEV_TOOLS=true` включает `/dev/*`: выпуск JWT любой организации, сид, подпись вебхуков. По умолчанию эти эндпоинты не регистрируются (404), и UI по `GET /dev/status` скрывает все dev-блоки: остаются ручной ввод JWT и реальные эндпоинты.

## Что реализовано

**Ядро**
- `POST /rpc/claim_next_contact` — выдача SQL-функцией `claim_next_contact`: все 5 правил, `FOR UPDATE SKIP LOCKED`, создание `call_attempts(status=queued)`; повторной выдачи до терминального статуса нет (частичный unique-индекс + маркер активной попытки).
- JWT HS256 (`sub`, `org_id`, `role ∈ worker|authenticated`). Изоляция организаций: API + forced RLS; подпись JWT повторно проверяется внутри PostgreSQL, поэтому роль веб-приложения в БД без валидного JWT ничего не видит.
- `POST /webhooks/calls` — HMAC-SHA256 от сырого тела (401 до разбора), маппинг типов → статусы, `started_at`/`ended_at`/`outcome`, идемпотентность по `event_id` и `(call_id, sequence)`, out-of-order по `sequence`, первый терминальный статус окончательный. Все принятые события — в `webhook_events`.
- Терминальные побочные эффекты — триггер БД (`attempts_count`, `last_attempt_at`, `do_not_call`) в той же транзакции, что и запись в CRM-outbox.
- CRM: transactional outbox + фоновый воркер (lease, timeout, экспоненциальный backoff, dead-статус). Состояние CRM не влияет на приём вебхуков.
- Структурные JSON-логи: `http_request`, `webhook_event`, `crm_delivery` с общим `correlation_id` (заголовок `X-Correlation-Id` или сгенерированный); он же сохраняется в `webhook_events`, `call_attempts`, `crm_outbox` и уходит в CRM заголовком.

**Разбор звонка**
- `POST /api/analyses`, `GET /api/analyses/:id`, `GET /api/analyses/:id/stream` (SSE), `POST /api/analyses/:id/cancel`; JWT, чужая организация → 404.
- Один анализ на попытку; повторный POST возвращает существующий. Транскрипт — колонка `call_attempts.transcript`, пустой → заглушка.
- Провайдер: 429 с `Retry-After` (ограниченное число повторов), обрыв после chunks → `partial`, без chunks → `error`, результат не по схеме → `error`; перезапуска генерации нет.
- SSE-журнал хранится в БД: стабильные `id`, `Last-Event-ID` отдаёт только продолжение.
- Схема результата — одна Zod-схема в `packages/contracts`, используется сервером и клиентом.
- UI: `data-state` на корневом `<main>` — `idle|queued|streaming|reconnecting|partial|error|cancelled|completed`; частичный результат остаётся при обрыве. Для автоматизации: `http://localhost:5173/?token=<jwt>&call_attempt_id=<uuid>` заполняет форму и сразу запускает разбор.

## JWT для ручной проверки

```bash
corepack pnpm install
JWT_SECRET=<как в .env> corepack pnpm jwt:generate -- --org-id <uuid> --sub user-1 --role authenticated
```

Без `DEV_TOOLS` UI работает в ручном режиме: «Ввести JWT вручную» + существующий `call_attempt_id`.

## Проверки

```bash
corepack pnpm typecheck && corepack pnpm test:p0 && corepack pnpm test:p1   # unit
corepack pnpm test:p0:integration && corepack pnpm test:p1:integration      # против запущенного compose
node scripts/acceptance.mjs                                                  # 82 black-box проверки по ТЗ + атомарность/ретраи/сбои
node scripts/resilience.mjs --mode=stop                                      # остановка API под нагрузкой, старт через 5 с (SIGTERM)
node scripts/resilience.mjs --mode=kill                                      # то же с SIGKILL
node scripts/load/claim.mjs --org=<uuid> --campaign=<uuid> --workers=20 --seconds=30
node scripts/load/webhooks.mjs --rps=50 --seconds=60 --drain-seconds=300
```

Скрипты в `scripts/` сами поднимают заглушки CRM/провайдера на портах хоста 18081/18082, поэтому `.env` должен указывать на `host.docker.internal:18081/18082` (как в `.env.example`), а профиль `mocks` должен быть выключен.

## Результаты нагрузки (подробно — `docs/performance.md`)

- `claim_next_contact`, 2 млн контактов: p95 **12.7 мс** (5 воркеров) / **36 мс** (20 воркеров) при 650–870 rps; сама функция в БД 2 мс.
- `POST /webhooks/calls`, 50 rps, CRM отвечает 1.5 с и отклоняет 50%: p99 **403–430 мс**, 0 ответов не-2xx; при 150 rps p99 929 мс.
- **Узкое место окружения — HDD (проверено).** На машине разработки (Docker Desktop/WSL2, HDD) fsync одного `COMMIT` стоит 35–200 мс, поэтому end-to-end p95 claim временами доходит до 170–220 мс при 2 мс внутри БД. Без fsync те же данные дают p95 7.7 / 22 мс. Синхронный commit оставлен: на SSD цель выполняется с запасом.
- **Перезапуск под нагрузкой** (стоп API, старт через 5 с; SIGTERM и SIGKILL): 0 ответов 5xx, 0 повторно применённых событий, все CRM-уведомления доставлены, генерация не перезапускалась, SSE без пропусков и повторов.

## Чего нет / ограничения

- Нет управления кампаниями/контактами через API и настоящего дозвона — вне объёма задания.
- Порядок выдачи «сначала не звонившие / давно звонившие» соблюдается внутри таймзоны, глобальной сортировки по кампании нет (дорого на 2 млн строк).
- Нет таймаута «зависшей» попытки: если провайдер так и не прислал терминальное событие, контакт не выдаётся повторно.
- Латентность выдачи end-to-end зависит от fsync диска: на HDD цель 100 мс p95 выполняется не всегда, на SSD — с запасом. `synchronous_commit` оставлен включённым: устойчивость важнее.
- CRM-доставка — at-least-once: после SIGKILL уведомление может уйти повторно; для дедупликации передаётся `Idempotency-Key: <attempt_id>`.

## Документация

`ASSUMPTIONS.md` — решения по неочевидным местам, `AI-USAGE.md` — инструменты, `docs/performance.md` — нагрузка и найденные дефекты, `docs/architecture.md`, `docs/database.md`, `docs/decisions.md`.
