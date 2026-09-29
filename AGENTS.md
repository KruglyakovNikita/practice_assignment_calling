# Сервис управления обзвоном — инструкции Codex

P0 реализован. Текущая цель следующего этапа — P1 из `docs/progress.md`; P0 invariants менять только при доказанной ошибке.

## Source of truth

Читать: `docs/progress.md`, `docs/p0-plan.md`, `docs/tz.md`, `docs/decisions.md`, `docs/architecture.md`, `docs/database.md`, `ASSUMPTIONS.md`, `docs/code-style.md`. Исходники задания: `docs/Тестовое задание. Full stack.md`, `docs/additional_description_to_task.md`, `docs/answer_to_the_question.md` — не редактировать по смыслу.

`.claude/` и `CLAUDE.md` — архив, не действующие инструкции.

## P0 invariants

- `claim_next_contact` остаётся SQL-side, `SKIP LOCKED`; одна active attempt на contact.
- Tenant isolation не переводить на доверенный `SET org_id`. RLS использует signed JWT context; app role не BYPASSRLS.
- Webhook HMAC только по raw body; `sequence` не приводить к JS number с потерей bigint.
- Lookup webhook только по `provider_call_id`; unknown call не создаёт attempt/event.
- Duplicate/out-of-order event не откатывает state; первый terminal финален; late answered может дополнить started_at.
- Terminal contact update и outbox insert атомарны; CRM network не выполнять в webhook transaction.
- Outbox lease/retry bounded; не делать бесконечный retry и не держать DB lock во время HTTP.
- Не логировать JWT/secrets/transcript/full payload.

## P1

Реализовать только раздел 7: один analysis на attempt, transcript fallback, provider SSE/429/cancel/partial/error, persisted SSE journal/Last-Event-ID, React UI. Не добавлять registration/admin/campaign CRUD/реальный LLM.

## Style/verification

Clean Architecture: adapters → application/use-cases → domain. TypeScript strict; type/interface lower camelCase, class/component PascalCase. Комментарии только для неочевидного инварианта, максимум коротко. Писать только tests, доказывающие контракт/critical failure path.

`docs/progress.md` отмечать `[x]` только после фактической проверки. Нагрузочные p95/p99 — только после измерения. Работать в текущей ветке, не затирать пользовательские изменения.
