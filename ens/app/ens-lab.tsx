'use client';

import { useState, type FormEvent } from 'react';
import { getAddress, isAddress, type Address } from 'viem';
import type { AppConfig, LabSettings, Resolution } from './types';

const defaults = { label: 'Existing configuration', enabled: true, limit: 10 };
const shortened = (address: string) => `${address.slice(0, 8)}…${address.slice(-6)}`;
const messages: Record<string, string> = {
  invalid_input: 'Enter a normalized ENS name or a nonzero Ethereum address.',
  invalid_name: 'This is not a valid ENS name. Check the label and try again.',
  body_too_large: 'The resolution request is too large.',
  resolution_failed: 'The name could not supply a valid on-chain configuration. Check its address record and app:enabled, app:limit, and app:label records, then try again.',
  wrong_chain: 'The server RPC is not on Sepolia (11155111). Check ENS_RPC_URL.',
  snapshot_unavailable: 'A complete block snapshot is unavailable. Try again.',
};

function ConfigRows({ config }: { config: AppConfig | null }) {
  return <dl className="config-rows"><div><dt>Label</dt><dd>{config?.label ?? defaults.label}</dd></div><div><dt>Recipient</dt><dd className="mono address-text">{config?.recipient ?? 'Not configured'}</dd></div><div><dt>Action</dt><dd>{config ? config.enabled ? 'Enabled' : 'Disabled' : 'Unavailable'}</dd></div><div><dt>Limit</dt><dd>{config?.limit ?? defaults.limit} units</dd></div></dl>;
}

export function EnsLab({ settings }: { settings: LabSettings }) {
  const [input, setInput] = useState(settings.initialName);
  const [baselineAddress, setBaselineAddress] = useState('');
  const [baseline, setBaseline] = useState<AppConfig | null>(null);
  const [baselineError, setBaselineError] = useState<string | null>(null);
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [source, setSource] = useState<'literal' | 'resolved'>('literal');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [units, setUnits] = useState('1');
  const [preview, setPreview] = useState<string | null>(null);
  const active = source === 'resolved' ? resolution?.config ?? null : baseline;
  const requested = Number(units);
  const withinLimit = Number.isInteger(requested) && requested > 0 && !!active && requested <= active.limit;
  const permitted = !!active?.enabled && withinLimit;

  function updateBaseline(event: FormEvent) {
    event.preventDefault(); setBaselineError(null); setPreview(null);
    const value = baselineAddress.trim();
    if (!isAddress(value, { strict: false }) || BigInt(value) === 0n) { setBaselineError('Enter a nonzero Ethereum address for the literal configuration.'); return; }
    setBaseline({ ...defaults, recipient: getAddress(value) }); setSource('literal');
  }
  async function resolve(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setResolution(null); setPreview(null);
    try {
      const response = await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ input }), cache: 'no-store' });
      const value = await response.json();
      if (!response.ok) throw new Error(messages[value.error] ?? 'Resolution failed. No fallback configuration was applied.');
      setResolution(value as Resolution); setSource('resolved');
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The resolution request failed.'); }
    finally { setBusy(false); }
  }
  function previewAction(event: FormEvent) {
    event.preventDefault();
    if (!active || !permitted) return;
    setPreview(JSON.stringify({ kind: 'local-configuration-preview', source, chainId: settings.chainId, recipient: active.recipient, requestedUnits: requested, configuredLimit: active.limit, enabled: active.enabled }, null, 2));
  }

  return <div className="shell">
    <header className="masthead"><a className="wordmark" href="/" aria-label="ENS Tokyo Kits home"><span className="ens-mark" aria-hidden="true">≋</span> ENS <span>/ TOKYO KITS</span></a><span className="edition">CONFIGURATION LAB · 02</span></header>
    <main>
      <section className="intro"><div><p className="eyebrow">ENSv2 · SEPOLIA</p><h1>Make the name<br /><em>do the work.</em></h1><p className="intro-copy">Resolve a recipient and application settings from ENS. Change the records, resolve again, and watch the same application respond.</p></div><aside className="network-note"><p className="eyebrow">READ-ONLY INTEGRATION</p><dl><div><dt>Network</dt><dd>Sepolia · 11155111</dd></div><div><dt>Source</dt><dd>{settings.transport}</dd></div><div><dt>Resolver</dt><dd><code title={settings.universalResolver}>{shortened(settings.universalResolver)}</code></dd></div></dl><p>Official Universal Resolver. Server-side RPC. On-chain records only.</p></aside></section>

      <section className="comparison" aria-label="Configuration sources">
        <article className="source-panel"><div className="panel-heading"><span className="step-index">01</span><div><p className="eyebrow">BEFORE · LITERAL VALUES</p><h2>Existing configuration</h2></div></div><p>Start with an address embedded in your application. This baseline has a fixed label, enabled action, and a 10-unit limit.</p><form onSubmit={updateBaseline}><label htmlFor="baseline">Literal recipient</label><div className="input-row"><input id="baseline" value={baselineAddress} onChange={event => setBaselineAddress(event.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} maxLength={42} /><button className="button-secondary" type="submit">Apply</button></div></form>{baselineError && <p className="error" role="alert">{baselineError}</p>}<ConfigRows config={baseline} /></article>
        <article className="source-panel ens-panel"><div className="panel-heading"><span className="step-index">02</span><div><p className="eyebrow">AFTER · RESOLVED RECORDS</p><h2>ENS configuration</h2></div></div><p>The address record supplies the recipient. Text records supply the label, enabled state, and limit; all are validated before use.</p><form onSubmit={resolve}><label htmlFor="ens-input">ENS name or literal address</label><div className="input-row"><input id="ens-input" value={input} onChange={event => setInput(event.target.value)} placeholder="your-name.eth" autoComplete="off" spellCheck={false} maxLength={255} required /><button type="submit" disabled={busy}>{busy ? 'Resolving…' : 'Resolve'} <span aria-hidden="true">↗</span></button></div></form>{error && <p className="error" role="alert">{error}</p>}{resolution ? <><p className="result-status" role="status">{resolution.source === 'ens' ? 'On-chain configuration resolved' : 'Literal address validated · no ENS lookup'}</p><ConfigRows config={resolution.config} /></> : <div className="empty-state" role="status"><span aria-hidden="true">↳</span><p>{busy ? 'Reading the selected name through the official resolver…' : 'No resolution yet. Records will appear here after a successful read.'}</p></div>}</article>
      </section>

      <section className="application" aria-labelledby="application-title"><div className="application-header"><div><p className="eyebrow">THE SAME APPLICATION</p><h2 id="application-title">{active?.label ?? 'Application preview'}</h2></div><div className="source-toggle" role="group" aria-label="Active configuration"><button className={source === 'literal' ? 'selected' : ''} onClick={() => { setSource('literal'); setPreview(null); }} disabled={!baseline} aria-pressed={source === 'literal'}>Literal</button><button className={source === 'resolved' ? 'selected' : ''} onClick={() => { setSource('resolved'); setPreview(null); }} disabled={!resolution} aria-pressed={source === 'resolved'}>Resolved</button></div></div><div className="application-body"><div><p className="recipient-label">CURRENT RECIPIENT</p><p className="active-recipient mono">{active?.recipient ?? 'Apply a configuration to begin'}</p><p className="application-note">{active ? `This action is ${active.enabled ? 'enabled' : 'disabled'} with a configured limit of ${active.limit} units.` : 'No default recipient or successful lookup is invented.'}</p></div><form onSubmit={previewAction} className="action-form"><label htmlFor="units">Requested units</label><div className="input-row"><input id="units" type="number" min="1" max="1000" step="1" value={units} onChange={event => { setUnits(event.target.value); setPreview(null); }} /><button type="submit" disabled={!permitted || busy}>Preview action <span aria-hidden="true">↗</span></button></div><p>{!active ? 'Configure a recipient first.' : !active.enabled ? 'The ENS or literal configuration disables this action.' : !withinLimit ? `Enter 1–${active.limit} whole units.` : 'Within the configured limit.'}</p></form></div>{preview && <div className="preview-result" role="status"><p>Local preview accepted. No wallet request or transaction was sent.</p><pre>{preview}</pre></div>}<p className="boundary-note">This preview demonstrates configuration-driven behavior. Client-side checks are not contract authorization. The CLI separately proves registry, resolver, and delegated permissions on a fork or testnet.</p></section>

      <section className="evidence" aria-labelledby="evidence-title"><div><p className="eyebrow">PROVENANCE</p><h2 id="evidence-title">Know what was read.</h2></div>{resolution?.evidence ? <dl className="evidence-data"><div><dt>Name</dt><dd>{resolution.evidence.name}</dd></div><div><dt>Chain</dt><dd>Sepolia · {resolution.evidence.chainId}</dd></div><div><dt>Block snapshot</dt><dd className="mono">{resolution.evidence.blockNumber}</dd></div><div><dt>Block hash</dt><dd className="mono">{resolution.evidence.blockHash}</dd></div><div><dt>Name resolver</dt><dd className="mono">{resolution.evidence.resolver}</dd></div><div><dt>Universal Resolver</dt><dd className="mono">{resolution.evidence.universalResolver}</dd></div><div><dt>Block time</dt><dd>{resolution.evidence.blockTimestamp}</dd></div><div><dt>Read completed</dt><dd>{resolution.evidence.readAt}</dd></div></dl> : <p className="evidence-empty">{resolution?.source === 'literal' ? 'A literal address was validated. There is no ENS block snapshot for this input.' : 'A successful ENS read will show its resolver, chain, and block snapshot here. A read does not establish registration or a write receipt.'}</p>}</section>

      <section className="record-guide"><div><p className="eyebrow">RECORD CONTRACT</p><h2>Four values.<br />Visible consequences.</h2><p>Use your parent name or a registered subname. The parent must link its subregistry for the subname to resolve.</p></div><table><caption className="sr-only">ENS configuration record schema</caption><thead><tr><th>Record</th><th>Accepted value</th><th>Changes</th></tr></thead><tbody><tr><td><code>addr</code></td><td>Nonzero ETH address</td><td>Action recipient</td></tr><tr><td><code>app:label</code></td><td>1–80 characters</td><td>Application heading</td></tr><tr><td><code>app:enabled</code></td><td><code>true</code> or <code>false</code></td><td>Action availability</td></tr><tr><td><code>app:limit</code></td><td>Whole number, 0–1000</td><td>Accepted request size</td></tr></tbody></table></section>
      <aside className="proof-note"><strong>Integration evidence stays separate.</strong> The CLI receipt proves executed writes; this interface proves live resolution and the resulting app state. Public hosting and a live Sepolia write require their own evidence. There is no demo-data fallback.</aside>
    </main><footer><span>Generic starter · MIT · Disclose the reused commit</span><a href="https://docs.ens.domains/ensv2/tutorial-app-developers/" target="_blank" rel="noreferrer">Official ENS documentation <span aria-hidden="true">↗</span></a></footer>
  </div>;
}
