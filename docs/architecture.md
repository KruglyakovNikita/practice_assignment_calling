# Архитектура

P0–P2 реализованы. Граница зависимостей: adapters → application/use-cases → domain. SQL-side claim/terminal trigger оставлены как намеренные исключения для атомарных DB-инвариантов.

## Структура

```text
app/backend/src/
  calls/domain
  calls/application/{ports,use-cases}
  calls/adapters/{http,sql}
  crm/application/{ports,use-cases}
  crm/adapters/{http,sql,cron}
  analyses/domain
  analyses/application/{ports,use-cases}
  analyses/adapters/{http,sql,worker}
  dev/                      # /dev/*, только при DEV_TOOLS=true
  shared/{auth,config,database,http,logging}
app/web/src/{setup,call,analysis,shared/api}
packages/contracts/        # общая Zod-схема результата
migrations/001_p0_core.sql … 004_p2_claim_performance.sql
scripts/                   # acceptance, resilience, load, dev-заглушки
```

Use case — один публичный `execute()` на прикладной сценарий; private helpers относятся к тому же сценарию. Repository/port может иметь несколько связанных persistence-операций одного агрегата — это обычный Repository pattern, а не нарушение правила «один use case на класс». Application/domain не импортируют NestJS, `pg` и React.

## P0 flows

**Claim.** JWT → tenant transaction + signed-JWT RLS → SQL `claim_next_contact` → `FOR UPDATE SKIP LOCKED` → queued attempt.

**Webhook.** raw-body HMAC → provider_call_id lookup → unique event → monotonic reducer → terminal trigger → contact side effects + CRM outbox в одной транзакции.

**CRM.** lease batch через `SKIP LOCKED`; HTTP выполняется вне транзакции; bounded retry/dead state.

## P1 analysis flow

**Create.** `POST /api/analyses` под tenant JWT проверяет call attempt через RLS. Допускается только terminal attempt. `UNIQUE(call_attempt_id)` гарантирует один analysis; повторный POST возвращает существующий фактический status.

**Worker.** `AnalysisWorker` держит ограниченное число in-flight jobs. Service repository атомарно claim-ит queued analysis, переводит в `streaming`, выдаёт lease token и читает `call_attempts.transcript`. NULL/blank заменяется fallback только перед provider request.

**Provider.** `ProcessNextAnalysisUseCase` вызывает `{PROVIDER_URL}/v1/analyze`. 429 повторяется по `Retry-After`, retry count bounded. HTTP/stream timeout и cancel используют AbortSignal. После начала stream сетевой обрыв не запускает новую генерацию.

**Persistence.** Каждый chunk атомарно добавляется к `partial_result` и записывается в `analysis_events`. Валидный done проверяется общей Zod-схемой и сохраняется как `completed`. Invalid done → `error` с сохранёнными chunks. Обрыв/timeout после chunks → `partial`, без chunks → `error`.

**Crash recovery.** Streaming job имеет lease + heartbeat. Истёкший lease или graceful stop: если поток провайдера не начинался — job снова `queued`; иначе `partial`/`error` без повторной генерации; cancel_requested → `cancelled`.

**SSE.** `GET /api/analyses/:id/stream` читает persisted journal. `analysis_events.id bigint` — стабильный SSE id; chunk также получает тот же `id` в data payload. `Last-Event-ID` → SQL `id > cursor`; disconnect клиента не влияет на provider job.

**UI.** React использует fetch-based SSE, чтобы передавать Bearer JWT и `Last-Event-ID`. Root container имеет `data-state=idle|queued|streaming|reconnecting|partial|error|cancelled|completed`; partial не очищается при reconnect/error.

## Security

- Tenant API: HS256 JWT + forced RLS с повторной проверкой JWT в PostgreSQL.
- Analysis rows/events имеют `org_id`, composite FK и RLS; foreign org получает 404.
- Worker использует service role с BYPASSRLS и ограниченными grants; внешний org_id не является authority.
- JWT, secrets, transcript и provider payload не логируются.

## P2

- Claim: `SECURITY DEFINER`, маркер активной попытки, partial-индекс `(campaign_id, timezone, cooldown, id)`, проба на каждую зону в окне (`docs/performance.md`).
- Graceful shutdown: воркеры CRM и анализа дожидаются начатой работы, SSE закрываются, пулы БД закрываются после HTTP.
- Dev-инструменты (`/dev/*`, dev-блоки UI) — только при `DEV_TOOLS=true`.
