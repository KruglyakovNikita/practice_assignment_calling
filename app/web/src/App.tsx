import { useState } from 'react';
import { useAnalysis } from './analysis/use-analysis';
import { claimNextContact, issueDevToken } from './shared/api/dev-api';

export function App() {
  const [token, setToken] = useState('');
  const [attemptId, setAttemptId] = useState('');
  const [orgId, setOrgId] = useState('');
  const [sub, setSub] = useState('worker');
  const [role, setRole] = useState<'worker' | 'authenticated'>('worker');
  const [campaignId, setCampaignId] = useState('');
  const [devError, setDevError] = useState('');
  const [claimedPhone, setClaimedPhone] = useState('');
  const analysis = useAnalysis();
  const canStart = token.trim().length > 0 && attemptId.trim().length > 0;
  const canCancel = ['queued', 'streaming', 'reconnecting'].includes(analysis.state);

  async function handleGenerateToken(): Promise<void> {
    setDevError('');
    try {
      setToken(await issueDevToken({ orgId: orgId.trim(), sub: sub.trim(), role }));
    } catch (error) {
      setDevError(error instanceof Error ? error.message : 'Не удалось сгенерировать JWT');
    }
  }

  async function handleClaimNext(): Promise<void> {
    setDevError('');
    setClaimedPhone('');
    try {
      const contact = await claimNextContact(token.trim(), campaignId.trim());
      if (!contact) {
        setDevError('Свободных контактов нет');
        return;
      }
      setAttemptId(contact.attempt_id);
      setClaimedPhone(contact.phone_e164);
    } catch (error) {
      setDevError(error instanceof Error ? error.message : 'Не удалось получить контакт');
    }
  }

  return (
    <main data-state={analysis.state} className="mx-auto min-h-screen max-w-4xl p-6 sm:p-10">
      <div className="space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <header>
          <h1 className="text-2xl font-semibold">Разбор звонка</h1>
          <p className="mt-1 text-sm text-slate-500">Состояние: <strong>{analysis.state}</strong></p>
        </header>

        <section className="space-y-3 rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Dev: получить JWT</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-sm font-medium">
              org_id
              <input
                className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"
                value={orgId}
                onChange={(event) => setOrgId(event.target.value)}
                placeholder="UUID организации"
              />
            </label>
            <label className="block text-sm font-medium">
              sub
              <input
                className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"
                value={sub}
                onChange={(event) => setSub(event.target.value)}
              />
            </label>
            <label className="block text-sm font-medium">
              role
              <select
                className="mt-2 w-full rounded-lg border border-slate-300 p-3 text-sm"
                value={role}
                onChange={(event) => setRole(event.target.value as 'worker' | 'authenticated')}
              >
                <option value="worker">worker</option>
                <option value="authenticated">authenticated</option>
              </select>
            </label>
          </div>
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
            disabled={orgId.trim().length === 0 || sub.trim().length === 0}
            onClick={() => void handleGenerateToken()}
          >
            Сгенерировать JWT
          </button>
        </section>

        <label className="block text-sm font-medium">
          JWT
          <textarea
            className="mt-2 min-h-24 w-full rounded-lg border border-slate-300 p-3 font-mono text-xs"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Bearer token без префикса Bearer"
          />
        </label>

        <section className="space-y-3 rounded-lg border border-slate-200 p-4">
          <h2 className="text-sm font-semibold text-slate-700">Dev: получить следующий контакт</h2>
          <label className="block text-sm font-medium">
            campaign_id
            <input
              className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"
              value={campaignId}
              onChange={(event) => setCampaignId(event.target.value)}
              placeholder="UUID кампании"
            />
          </label>
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
            disabled={token.trim().length === 0 || campaignId.trim().length === 0}
            onClick={() => void handleClaimNext()}
          >
            Получить call_attempt_id
          </button>
          {claimedPhone && <p className="text-xs text-slate-500">Телефон: {claimedPhone}</p>}
        </section>

        {devError && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{devError}</p>}

        <label className="block text-sm font-medium">
          call_attempt_id
          <input
            className="mt-2 w-full rounded-lg border border-slate-300 p-3 font-mono text-sm"
            value={attemptId}
            onChange={(event) => setAttemptId(event.target.value)}
            placeholder="UUID завершённой попытки"
          />
        </label>

        <div className="flex gap-3">
          <button
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
            disabled={!canStart || canCancel}
            onClick={() => void analysis.start(token.trim(), attemptId.trim())}
          >
            Запустить анализ
          </button>
          <button
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium disabled:opacity-40"
            disabled={!canCancel}
            onClick={() => void analysis.cancel(token.trim())}
          >
            Отменить
          </button>
        </div>

        {analysis.analysisId && <p className="break-all text-xs text-slate-500">analysis_id: {analysis.analysisId}</p>}
        {analysis.error && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{analysis.error}</p>}

        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Частичный результат</h2>
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
        </section>

        {analysis.result && (
          <section className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <h2 className="font-semibold">Финальный результат</h2>
            <p>{analysis.result.summary}</p>
            <p><strong>Возражения:</strong> {analysis.result.objections.join(', ') || '—'}</p>
            <p><strong>Следующий шаг:</strong> {analysis.result.next_step}</p>
            <p><strong>Lead score:</strong> {analysis.result.lead_score}</p>
            <p><strong>Confidence:</strong> {analysis.result.confidence}</p>
          </section>
        )}
      </div>
    </main>
  );
}
