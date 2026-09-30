import { useState } from 'react';
import { setTranscript } from '../shared/api/dev-api';
import { Badge, Button, Card, Field, KeyValue, Notice } from '../ui';
import type { useAnalysis } from './use-analysis';

const presets: { label: string; text: string }[] = [
  { label: 'Обычный', text: 'Клиент интересуется тарифом и просит прислать коммерческое предложение.' },
  { label: '429 → повтор', text: '[429] Провайдер сначала просит подождать.' },
  { label: 'Обрыв потока', text: '[break] Поток оборвётся после первого фрагмента.' },
  { label: 'Невалидный результат', text: '[invalid] lead_score вне 0..100.' },
  { label: 'Бесконечный поток', text: '[slow] Для отмены и переподключения.' },
  { label: 'Пусто → заглушка', text: '' }
];

export function AnalysisPanel(props: { devTools: boolean; token: string; attemptId: string; analysis: ReturnType<typeof useAnalysis> }) {
  const { analysis } = props;
  const [transcript, setTranscriptText] = useState(presets[0]!.text);
  const [notice, setNotice] = useState('');
  const active = ['queued', 'streaming', 'reconnecting'].includes(analysis.state);

  async function start(): Promise<void> {
    setNotice('');
    // Without dev tools the attempt keeps the transcript it already has in call_attempts.
    if (props.devTools) {
      try {
        await setTranscript(props.attemptId, transcript.trim() ? transcript : null);
      } catch (cause) {
        setNotice(cause instanceof Error ? cause.message : String(cause));
      }
    }
    await analysis.start(props.token, props.attemptId);
  }

  return (
    <Card
      step="Шаг 3"
      title="Разбор звонка (SSE)"
      hint="Нужна терминальная попытка (completed / failed / no_answer). Один разбор на попытку: повторный запуск вернёт уже существующий, для нового сценария возьмите новый контакт."
      aside={<Badge value={analysis.state} />}
    >
      {props.devTools && (
        <>
          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`rounded-full border px-3 py-1 text-xs ${transcript === preset.text ? 'border-indigo-500 bg-indigo-50 text-indigo-700' : 'border-slate-300'}`}
                onClick={() => setTranscriptText(preset.text)}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <Field label="call_attempts.transcript (маркеры в [ ] управляют dev-провайдером)" value={transcript} onChange={setTranscriptText} multiline />
        </>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!props.token || !props.attemptId || active} onClick={() => void start()}>Запустить разбор</Button>
        <Button variant="danger" disabled={!active} onClick={() => void analysis.cancel(props.token)}>Отменить</Button>
        <Button disabled={!active} onClick={analysis.dropConnection}>Разорвать SSE (проверить Last-Event-ID)</Button>
      </div>
      {notice && <Notice tone="error">{notice}</Notice>}
      {analysis.error && <Notice tone="error">{analysis.error}</Notice>}
      {analysis.analysisId && <KeyValue rows={[['analysis_id', analysis.analysisId]]} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Накопленный результат</h3>
          {Object.keys(analysis.partial).length === 0 ? (
            <p className="text-sm text-slate-400">Фрагментов пока нет.</p>
          ) : (
            Object.entries(analysis.partial).map(([field, value]) => (
              <div key={field} className="rounded-lg bg-slate-50 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{field}</div>
                <div className="mt-1 whitespace-pre-wrap text-sm">{value}</div>
              </div>
            ))
          )}
          {analysis.result && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
              <div className="mb-1 font-semibold">Финальный результат (прошёл схему)</div>
              <KeyValue rows={[
                ['summary', analysis.result.summary],
                ['objections', analysis.result.objections.join(', ') || '—'],
                ['next_step', analysis.result.next_step],
                ['lead_score', analysis.result.lead_score],
                ['confidence', analysis.result.confidence]
              ]} />
            </div>
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">SSE-журнал</h3>
          <ol className="max-h-80 space-y-1 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-4 text-slate-100">
            {analysis.log.length === 0 && <li className="text-slate-500">пусто</li>}
            {analysis.log.map((entry, index) => (
              <li key={index} className={entry.kind === 'event' ? '' : 'text-amber-300'}>
                <span className="text-slate-500">{entry.at} </span>
                {entry.kind === 'event'
                  ? <>id:{entry.id || '—'} <b>{entry.event}</b> {JSON.stringify(entry.data)}</>
                  : <>── {entry.note}</>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Card>
  );
}
