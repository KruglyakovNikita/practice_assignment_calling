import { useState } from 'react';
import { issueDevToken, seedDemo, type seedResult } from '../shared/api/dev-api';
import { Button, Card, Field, KeyValue, Notice } from '../ui';

export function SetupPanel(props: {
  devTools: boolean;
  token: string;
  onToken: (token: string) => void;
  campaignId: string;
  onCampaignId: (campaignId: string) => void;
}) {
  const [seeded, setSeeded] = useState<seedResult | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [orgId, setOrgId] = useState('');
  const [sub, setSub] = useState('demo-user');
  const [role, setRole] = useState<'worker' | 'authenticated'>('worker');

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const seed = () => run(async () => {
    const result = await seedDemo(5);
    setSeeded(result);
    setOrgId(result.org_id);
    props.onToken(result.token);
    props.onCampaignId(result.campaign_id);
  });

  const issue = () => run(async () => {
    props.onToken((await issueDevToken({ orgId: orgId.trim(), sub: sub.trim(), role })).token);
  });

  return (
    <Card
      step="Шаг 1"
      title="Подготовка"
      hint={props.devTools
        ? 'Dev-режим: демо-данные и JWT выпускает сервер. Или введите свои значения ниже.'
        : 'Вставьте JWT (HS256, claims sub / org_id / role) и campaign_id. Dev-инструменты выключены (DEV_TOOLS=false).'}
    >
      {props.devTools && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" disabled={busy} onClick={() => void seed()}>Создать демо-данные</Button>
            <span className="text-xs text-slate-500">организация, активная кампания, 5 контактов в рабочей таймзоне + JWT</span>
          </div>
          {seeded && (
            <KeyValue rows={[
              ['org_id', seeded.org_id],
              ['campaign_id', seeded.campaign_id],
              ['таймзона', seeded.timezone],
              ['контактов', seeded.contacts]
            ]} />
          )}
          <div className="rounded-xl border border-dashed border-slate-300 p-3">
            <div className="mb-2 text-sm font-semibold">Выпустить JWT (POST /dev/token)</div>
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
              <Field label="org_id" value={orgId} onChange={setOrgId} placeholder="UUID организации" mono />
              <Field label="sub" value={sub} onChange={setSub} />
              <label className="block text-xs font-medium text-slate-600">
                role
                <select className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as 'worker' | 'authenticated')}>
                  <option value="worker">worker</option>
                  <option value="authenticated">authenticated</option>
                </select>
              </label>
              <Button disabled={busy || !orgId.trim() || !sub.trim()} onClick={() => void issue()}>Сгенерировать</Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">Токен другой организации — удобный способ увидеть 404 на чужих разборах и пустую выдачу из чужой кампании.</p>
          </div>
        </>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      <div className="space-y-3">
        <Field label="JWT (без префикса Bearer)" value={props.token} onChange={props.onToken} mono multiline />
        <Field label="campaign_id" value={props.campaignId} onChange={props.onCampaignId} mono />
      </div>
    </Card>
  );
}
