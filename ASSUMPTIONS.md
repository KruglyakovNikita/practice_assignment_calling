# Решения и допущения

Статус: P0 реализован; P1 ещё не начат.

## Подтверждённые решения

- NestJS + TypeScript, PostgreSQL 16, Clean Architecture. P0 = ядро разделов 4–6.1; P1 = раздел 7.
- `call_id` webhook сопоставляется только с сохранённым `call_attempts.provider_call_id`.
- При claim один UUID используется как `call_attempts.id`, его string — `provider_call_id`, наружу он возвращается как `attempt_id`. CHECK равенства не вводится: стенд может записывать произвольные provider ids.
- Первый terminal status финален; stale sequence не откатывает state; late answered может заполнить отсутствующий `started_at`.
- CRM отделена transactional outbox. Доставка at-least-once; network call не находится внутри webhook DB transaction.
- `call_attempts.transcript text NULL` уже добавлен для P1. NULL/empty/whitespace в P1 будет заменяться только при отправке провайдеру фиксированной заглушкой, исходная колонка не переписывается.
- Один analysis на `call_attempt_id` и persisted SSE journal — решение P1, не P0.

## Security choice P0

Простой custom GUC `app.org_id` не используется как boundary, потому что DB user мог бы подменить его. Tenant DB role передаёт в transaction `app.jwt`; RLS SECURITY DEFINER функция проверяет HS256 подпись JWT по secret из закрытой `app_private.settings` и только затем получает `org_id`.

Backend использует отдельные pool:
- tenant pool — low-privilege `auto_calling_app`, RLS enforced;
- service pool — отдельная `auto_calling_service` role с BYPASSRLS, но только точечными DML grants для webhook/outbox; migrations остаются под postgres. Внешний `org_id` не используется как authority.

## Retry defaults P0

CRM defaults: timeout 1500 ms, batch 20, lease 15 s, max attempts 8, base retry 1 s, cap 60 s. Все значения конфигурируются env; dead row остаётся в БД для ручного разбора, автоматического бесконечного retry нет.

## Что ещё должно быть доказано

Performance targets (`claim p95<=100ms` на 2 млн contacts, webhook `p99<=1s` при 50 rps) не считаются выполненными до P2 load run. В текущей среде сборки без npm registry/Docker нельзя честно заявить фактический compose/integration прогон; тесты для этого включены в репозиторий.
