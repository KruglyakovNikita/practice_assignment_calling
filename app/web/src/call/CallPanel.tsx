import { useEffect, useState } from 'react';
import {
  claimNextContact,
  getAttempt,
  sendWebhook,
  type attemptSnapshot,
  type callEventType,
  type claimedContact,
  type sentWebhook
} from '../shared/api/dev-api';
import { Badge, Button, Card, Field, KeyValue, Notice, time } from '../ui';

const eventButtons: { type: callEventType; label: string; data: Record<string, unknown> }[] = [
  { type: 'call.queued', label: 'queued', data: {} },
  { type: 'call.dialing', label: 'dialing', data: {} },
  { type: 'call.answered', label: 'answered', data: { sip_code: 200 } },
  { type: 'call.completed', label: 'completed', data: { sip_code: 200, duration_sec: 42 } },
  { type: 'call.failed', label: 'failed', data: { sip_code: 503 } },
  { type: 'call.no_answer', label: 'no_answer', data: { sip_code: 486 } }
];
const terminal = new Set<callEventType>(['call.completed', 'call.failed', 'call.no_answer']);

export function CallPanel(props: { devTools: boolean; token: string; campaignId: string; attemptId: string; onAttemptId: (id: string) => void }) {
  const [contact, setContact] = useState<claimedContact | null>(null);
  const [claimInfo, setClaimInfo] = useState('');
  const [error, setError] = useState('');
  const [doNotCall, setDoNotCall] = useState(false);
  const [sequence, setSequence] = useState('');
  const [sent, setSent] = useState<sentWebhook[]>([]);
  const [snapshot, setSnapshot] = useState<attemptSnapshot | null>(null);

  useEffect(() => {
    setSnapshot(null);
    if (!props.attemptId || !props.devTools) return;
    let stopped = false;
    const load = () => getAttempt(props.attemptId).then((value) => { if (!stopped) setSnapshot(value); }, () => undefined);
    void load();
    const timer = setInterval(() => void load(), 1000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [props.attemptId, props.devTools]);

  async function claim(): Promise<void> {
    setError('');
    setClaimInfo('');
    try {
      const claimed = await claimNextContact(props.token, props.campaignId);
      if (!claimed) {
        setClaimInfo('{"contact": null} — подходящих контактов нет (активные попытки, кулдаун 4 ч, окно 09–20, лимит 3 попытки, DNC).');
        return;
      }
      setContact(claimed);
      setSent([]);
      props.onAttemptId(claimed.attempt_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка claim');
    }
  }

  async function send(type: callEventType, data: Record<string, unknown>, replay?: sentWebhook): Promise<void> {
    setError('');
    try {
      const callId = snapshot?.attempt.provider_call_id ?? props.attemptId;
      const result = await sendWebhook(replay
        ? { callId: replay.event.call_id, type: replay.event.type, data: replay.event.data, sequence: replay.event.sequence, eventId: replay.event.event_id }
        : {
            callId,
            type,
            data: terminal.has(type) && doNotCall ? { ...data, do_not_call: true } : data,
            sequence: sequence.trim() ? Number(sequence) : undefined
          });
      setSent((current) => [result, ...current]);
      setSequence('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Ошибка отправки');
    }
  }

  const attempt = snapshot?.attempt;
  return (
    <Card
      step="Шаг 2"
      title="Звонок: выдача и вебхуки провайдера"
      hint={props.devTools
        ? 'Воркер берёт контакт, «провайдер» шлёт события. Сервер подписывает их WEBHOOK_SECRET и отправляет в настоящий POST /webhooks/calls.'
        : 'POST /rpc/claim_next_contact. Вебхуки шлёт внешний провайдер; кнопки событий доступны только с DEV_TOOLS=true.'}
      aside={attempt && <Badge value={attempt.status} />}
    >
      <div className="flex flex-wrap items-end gap-2">
        <Button variant="primary" disabled={!props.token || !props.campaignId} onClick={() => void claim()}>Получить контакт (claim)</Button>
        {contact && <span className="text-sm text-slate-600">📞 {contact.phone_e164}</span>}
      </div>
      {claimInfo && <Notice tone="info">{claimInfo}</Notice>}
      <Field label="call_attempt_id" value={props.attemptId} onChange={props.onAttemptId} placeholder="появится после claim или вставьте существующий" mono />

      {props.devTools && <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {eventButtons.map((button) => (
            <Button key={button.type} disabled={!props.attemptId} onClick={() => void send(button.type, button.data)}>{button.label}</Button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={doNotCall} onChange={(e) => setDoNotCall(e.target.checked)} />
            <span>do_not_call: true в терминальном событии</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="text-slate-500">sequence</span>
            <input className="w-24 rounded border border-slate-300 px-2 py-1 font-mono text-xs" value={sequence} placeholder="авто" onChange={(e) => setSequence(e.target.value.replace(/\D/g, ''))} />
          </label>
          <Button disabled={sent.length === 0} onClick={() => void send(sent[0]!.event.type, sent[0]!.event.data, sent[0])}>Повторить последнее (дубль)</Button>
        </div>
      </div>}
      {error && <Notice tone="error">{error}</Notice>}

      {sent.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Отправленные события</h3>
          <table className="w-full text-left font-mono text-xs">
            <thead className="text-slate-500"><tr><th>seq</th><th>type</th><th>HTTP</th><th>результат</th></tr></thead>
            <tbody>
              {sent.map((item, index) => (
                <tr key={`${item.event.event_id}-${index}`} className="border-t border-slate-100">
                  <td>{item.event.sequence}</td>
                  <td>{item.event.type}</td>
                  <td className={item.http_status < 300 ? 'text-emerald-700' : 'text-red-700'}>{item.http_status}</td>
                  <td>{item.response?.duplicate ? 'дубль — не применён' : item.response?.code ?? 'применён'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {attempt && (
        <div className="grid gap-4 rounded-xl bg-slate-50 p-4 lg:grid-cols-2">
          <div>
            <h3 className="mb-2 text-sm font-semibold">call_attempts (из БД, обновляется раз в секунду)</h3>
            <KeyValue rows={[
              ['status', <Badge key="s" value={attempt.status} />],
              ['provider_call_id', attempt.provider_call_id],
              ['started_at', time(attempt.started_at)],
              ['ended_at', time(attempt.ended_at)],
              ['last_sequence', attempt.last_sequence],
              ['outcome', attempt.outcome ? JSON.stringify(attempt.outcome) : null],
              ['correlation_id', attempt.correlation_id]
            ]} />
          </div>
          <div className="space-y-4">
            <div>
              <h3 className="mb-2 text-sm font-semibold">contacts (эффекты триггера)</h3>
              <KeyValue rows={[
                ['attempts_count', attempt.contact.attempts_count],
                ['last_attempt_at', time(attempt.contact.last_attempt_at)],
                ['do_not_call', String(attempt.contact.do_not_call)]
              ]} />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Уведомление CRM (outbox)</h3>
              {snapshot.crm ? (
                <KeyValue rows={[
                  ['status', <Badge key="c" value={snapshot.crm.status} />],
                  ['попыток', snapshot.crm.attempts],
                  ['последняя ошибка', snapshot.crm.last_error],
                  ['следующая попытка', snapshot.crm.status === 'pending' ? time(snapshot.crm.next_attempt_at) : null],
                  ['доставлено', time(snapshot.crm.delivered_at)]
                ]} />
              ) : <p className="text-xs text-slate-400">появится после терминального события</p>}
            </div>
          </div>
          <div className="lg:col-span-2">
            <h3 className="mb-1 text-sm font-semibold">webhook_events ({snapshot.webhook_events.length})</h3>
            <table className="w-full text-left font-mono text-xs">
              <tbody>
                {snapshot.webhook_events.map((event) => (
                  <tr key={event.event_id} className="border-t border-slate-200">
                    <td className="pr-2">#{event.sequence}</td>
                    <td className="pr-2">{event.type}</td>
                    <td className="pr-2 text-slate-500">{time(event.received_at)}</td>
                    <td className="truncate text-slate-400">{event.correlation_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  );
}
