import { useEffect, useState } from 'react';
import { AnalysisPanel } from './analysis/AnalysisPanel';
import { useAnalysis } from './analysis/use-analysis';
import { CallPanel } from './call/CallPanel';
import { devToolsEnabled } from './shared/api/dev-api';
import { SetupPanel } from './setup/SetupPanel';

// Automation entry point: /?token=<jwt>&call_attempt_id=<uuid> pre-fills the form and starts the analysis.
const params = new URLSearchParams(window.location.search);

export function App() {
  const [token, setToken] = useState(params.get('token') ?? '');
  const [campaignId, setCampaignId] = useState('');
  const [attemptId, setAttemptId] = useState(params.get('call_attempt_id') ?? '');
  const [devTools, setDevTools] = useState(false);
  const analysis = useAnalysis();

  useEffect(() => {
    void devToolsEnabled().then(setDevTools);
    if (token && attemptId) void analysis.start(token.trim(), attemptId.trim());
  }, []);

  return (
    <main data-state={analysis.state} className="mx-auto min-h-screen max-w-6xl space-y-5 p-4 sm:p-8">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Обзвон: ручная проверка флоу</h1>
          <p className="text-sm text-slate-500">claim → вебхуки провайдера → триггер и CRM → разбор звонка по SSE</p>
        </div>
        <p className="flex items-center gap-3 text-sm text-slate-500">
          {devTools && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800">DEV_TOOLS</span>}
          <span>data-state: <strong className="font-mono">{analysis.state}</strong></span>
        </p>
      </header>
      <SetupPanel devTools={devTools} token={token} onToken={setToken} campaignId={campaignId} onCampaignId={setCampaignId} />
      <CallPanel devTools={devTools} token={token.trim()} campaignId={campaignId.trim()} attemptId={attemptId.trim()} onAttemptId={setAttemptId} />
      <AnalysisPanel devTools={devTools} token={token.trim()} attemptId={attemptId.trim()} analysis={analysis} />
    </main>
  );
}
