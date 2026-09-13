'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { MiniKit } from '@worldcoin/minikit-js';
import { MiniKitProvider, useMiniKit } from '@worldcoin/minikit-js/provider';
import { IDKitRequestWidget, type IDKitResult } from '@worldcoin/idkit';
import { getAddress, hexToBytes, isAddress, toHex, type Address, type Hex } from 'viem';
import type { Challenge } from '../world-id-verify/server/challenge';
import type { PingCall, PingReceipt, PublicConfig, SessionState } from './types';

interface BrowserWallet {
  request(input: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(name: string, listener: () => void): void;
  removeListener?(name: string, listener: () => void): void;
}
function browserWallet(): BrowserWallet | undefined { return (window as unknown as { ethereum?: BrowserWallet }).ethereum; }
const short = (value: string) => `${value.slice(0, 8)}…${value.slice(-6)}`;
const errors: Record<string, string> = {
  origin_rejected: 'This URL does not match WORLD_APP_ORIGIN. Update the server origin and restart.',
  world_id_not_configured: 'Configure the World ID app, RP ID, and server signing key first.',
  nonce_expired_or_used: 'This sign-in request expired or was already used. Start again.',
  nullifier_already_used: 'This World ID has already completed the configured action.',
  challenge_expired: 'The verification request expired. Create a new request.',
  public_ping_not_configured: 'A public World Chain ping contract and Portal allowlist are required.',
  world_id_verification_required: 'Complete server-verified World ID verification first.',
  userop_lookup_unavailable: 'The official user-operation lookup is unavailable. Submission is not yet confirmed.',
  matching_ping_event_missing: 'The transaction does not contain the expected ping event.',
  wallet_signature_rejected: 'The server could not verify this wallet signature.',
};
function explain(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The request could not be completed.';
  return errors[message] ?? message.replaceAll('_', ' ');
}
async function api<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const response = await fetch(path, { method, credentials: 'same-origin', cache: 'no-store',
    ...(method === 'GET' || method === 'DELETE' ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Request failed');
  return data as T;
}
function Arrow() { return <span aria-hidden="true">↗</span>; }
function Status({ good, children }: { good?: boolean; children: ReactNode }) { return <span className={`status ${good ? 'status-good' : ''}`}><span />{children}</span>; }

export function WorldLab({ config }: { config: PublicConfig }) {
  return <MiniKitProvider props={{ appId: config.miniAppId ?? undefined }}><Lab config={config} /></MiniKitProvider>;
}

function Lab({ config }: { config: PublicConfig }) {
  const { isInstalled } = useMiniKit();
  const [wallet, setWallet] = useState<Address | null>(null);
  const [authenticated, setAuthenticated] = useState(false);
  const [humanVerified, setHumanVerified] = useState(false);
  const [hasBrowserWallet, setHasBrowserWallet] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('Configure your Portal apps, then work through the three steps.');
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [walletSignature, setWalletSignature] = useState<Hex | null>(null);
  const [widgetOpen, setWidgetOpen] = useState(false);
  const [verifiedResult, setVerifiedResult] = useState<IDKitResult | null>(null);
  const [submission, setSubmission] = useState<{ userOpHash: Hex; note: Hex } | null>(null);
  const [receipt, setReceipt] = useState<PingReceipt | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true; setHasBrowserWallet(!!browserWallet());
    void api<SessionState>('/api/session', undefined, 'GET').then(current => {
      if (!alive.current) return;
      setWallet(current.wallet); setAuthenticated(true); setHumanVerified(current.humanVerified);
      setMessage(current.humanVerified ? 'Server-verified session restored.' : 'Wallet session restored. World ID verification is next.');
    }).catch(() => { /* An absent session is the normal initial state. */ });
    return () => { alive.current = false; };
  }, []);

  async function disconnect() {
    setWallet(null); setAuthenticated(false); setHumanVerified(false); setChallenge(null); setWalletSignature(null);
    setVerifiedResult(null); setSubmission(null); setReceipt(null); setWidgetOpen(false);
    try { await api('/api/session', undefined, 'DELETE'); } catch (caught) { setError(explain(caught)); }
  }
  useEffect(() => {
    const provider = browserWallet();
    const changed = () => { void disconnect(); setMessage('Wallet changed. Connect and verify the selected wallet again.'); };
    provider?.on?.('accountsChanged', changed);
    return () => provider?.removeListener?.('accountsChanged', changed);
    // The listener intentionally clears all wallet-bound proof state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function authenticate() {
    setBusy('wallet'); setError(null);
    try {
      if (!isInstalled) throw new Error('Open this configured Mini App inside World App to use wallet authentication.');
      const nonce = await api<{ nonce: string; statement: string; requestId: string; expirationTime: string }>('/api/wallet/nonce');
      const result = await MiniKit.walletAuth({ nonce: nonce.nonce, statement: nonce.statement, requestId: nonce.requestId, expirationTime: new Date(nonce.expirationTime) });
      if (result.executedWith === 'fallback') throw new Error('World App did not execute wallet authentication.');
      const current = await api<SessionState>('/api/wallet/verify', { payload: result.data });
      setWallet(current.wallet); setAuthenticated(true); setHumanVerified(false); setVerifiedResult(null); setReceipt(null);
      setMessage('Wallet signature verified on the server. No assets were transferred.');
    } catch (caught) { setError(explain(caught)); }
    finally { setBusy(null); }
  }
  async function connectBrowser() {
    setBusy('wallet'); setError(null);
    try {
      const provider = browserWallet();
      if (!provider) throw new Error('No injected wallet was detected in this browser.');
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      if (!Array.isArray(accounts) || typeof accounts[0] !== 'string' || !isAddress(accounts[0], { strict: false })) throw new Error('Wallet did not return an address.');
      await disconnect(); setWallet(getAddress(accounts[0]));
      setMessage('Browser wallet connected. Its signature will be verified with the World ID challenge.');
    } catch (caught) { setError(explain(caught)); }
    finally { setBusy(null); }
  }
  async function beginVerification() {
    setBusy('world-id'); setError(null); setVerifiedResult(null);
    try {
      if (!wallet) throw new Error('Connect a wallet first.');
      const created = await api<Challenge>('/api/world-id/challenge', { wallet });
      let signature: unknown;
      if (isInstalled) {
        const signed = await MiniKit.signMessage({ message: created.walletMessage });
        if (signed.executedWith === 'fallback' || signed.data.address.toLowerCase() !== wallet.toLowerCase()) throw new Error('The signing wallet does not match the challenge.');
        signature = signed.data.signature;
      } else {
        const provider = browserWallet(); if (!provider) throw new Error('Connect an injected wallet or open World App.');
        signature = await provider.request({ method: 'personal_sign', params: [toHex(created.walletMessage), wallet] });
      }
      if (typeof signature !== 'string' || !/^0x(?:[a-fA-F0-9]{2})+$/.test(signature)) throw new Error('Wallet returned an invalid signature.');
      setChallenge(created); setWalletSignature(signature as Hex); setWidgetOpen(true);
      setMessage('Wallet binding signed. Complete the proof-of-human request in World App.');
    } catch (caught) { setError(explain(caught)); setBusy(null); }
  }
  async function verifyOnServer(result: IDKitResult) {
    if (!challenge || !walletSignature) throw new Error('The wallet-bound challenge is missing.');
    try {
      const verified = await api<SessionState>('/api/world-id/verify', { challengeId: challenge.challengeId, walletSignature, result });
      setWallet(verified.wallet); setAuthenticated(true); setHumanVerified(verified.humanVerified); setVerifiedResult(result);
      setMessage(`World ID verified by the server in ${challenge.environment}. The nullifier has been recorded once.`);
    } catch (caught) { setError(explain(caught)); throw caught; }
  }
  function exportProof() {
    if (!challenge || !verifiedResult) return;
    const data = { wallet: challenge.wallet, rpId: challenge.rp_context.rp_id, action: challenge.action, result: verifiedResult };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'world-id-private-proof.json'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function checkReceipt(pending: { userOpHash: Hex; note: Hex }, repeat: boolean) {
    for (let attempt = 0; attempt < (repeat ? 30 : 1); attempt++) {
      const result = await api<PingReceipt | { status: 'submitted' }>('/api/ping/receipt', pending);
      if (!alive.current) return;
      if (result.status === 'confirmed') { setReceipt(result); setMessage('Confirmed on World Chain. The receipt contains your exact ping event.'); return; }
      if (repeat) await new Promise(resolve => setTimeout(resolve, 1500));
    }
    setMessage('Submitted to World App. A matching transaction receipt is still pending.');
  }
  async function sendPing() {
    setBusy('ping'); setError(null); setReceipt(null);
    try {
      if (!isInstalled || !humanVerified || !config.pingReady) throw new Error('World App, a verified session, and a configured public ping contract are required.');
      const call = await api<PingCall>('/api/ping/prepare');
      const result = await MiniKit.sendTransaction({ chainId: 480, transactions: [{ to: call.to, data: call.data, value: '0x0' }] });
      if (result.executedWith === 'fallback' || result.data.from.toLowerCase() !== wallet?.toLowerCase() || !/^0x[a-fA-F0-9]{64}$/.test(result.data.userOpHash)) throw new Error('World App did not return the expected submitted operation.');
      const pending = { userOpHash: result.data.userOpHash as Hex, note: call.note }; setSubmission(pending);
      setMessage('Submitted. Waiting for an actual transaction receipt and matching ping event.');
      await checkReceipt(pending, true);
    } catch (caught) { setError(explain(caught)); }
    finally { setBusy(null); }
  }

  return <div className="lab-shell">
    <header className="masthead"><a href="/" className="wordmark" aria-label="Tokyo Kits World home"><span className="world-mark" aria-hidden="true" />WORLD <span className="wordmark-divider">/</span> <span className="kit-label">TOKYO KITS</span></a><span className="edition">INTEGRATION LAB · 01</span></header>
    <main>
      <section className="intro" aria-labelledby="page-title"><div><p className="eyebrow">MINIKIT 2 + WORLD ID 4</p><h1 id="page-title">A wallet.<br />A human.<br /><em>A verified action.</em></h1><p className="intro-copy">Three small integrations, one visible proof trail. Connect a wallet, verify a human, and record a zero-value ping.</p></div><aside className="environment-panel" aria-label="Environment"><p className="eyebrow">CURRENT ENVIRONMENT</p><dl><div><dt>Network</dt><dd>World Chain <span className="mono">480</span></dd></div><div><dt>World ID</dt><dd>{config.environment}</dd></div><div><dt>Transport</dt><dd>{isInstalled === undefined ? 'Detecting…' : isInstalled ? 'World App' : 'Web browser'}</dd></div><div><dt>Live proof</dt><dd><Status good={!!receipt}>{receipt ? 'Receipt confirmed' : 'Not proven'}</Status></dd></div></dl><p>Local fork tests are separate from a live World App session.</p></aside></section>

      {(!config.worldIdReady || !config.miniAppId) && <section className="setup-note" aria-labelledby="setup-title"><span className="setup-symbol" aria-hidden="true">↳</span><div><h2 id="setup-title">Portal setup required</h2><p>{!config.miniAppId ? 'Set WORLD_MINIKIT_APP_ID for the Mini App. ' : ''}{!config.worldIdReady ? `World ID needs: ${config.missingWorldId.join(', ')}. ` : ''}Keep signing keys on the server. The two integrations may use separate Portal apps.</p><a href="#setup">Open setup checklist <Arrow /></a></div></section>}

      <section className="steps" aria-label="Integration steps">
        <article className="step"><div className="step-number">01</div><div className="step-body"><div className="step-heading"><h2>Connect the wallet</h2><Status good={authenticated}>{authenticated ? 'Server authenticated' : wallet ? 'Connected' : 'Not connected'}</Status></div><p>World App signs a one-time sign-in request. The server checks its origin, expiry, and wallet signature.</p>{wallet && <div className="wallet-address mono" title={wallet}>{short(wallet)} <button className="text-button" onClick={() => void disconnect()} disabled={!!busy}>Disconnect</button></div>}<div className="actions"><button onClick={() => void authenticate()} disabled={!!busy || !isInstalled || !config.miniAppId}>{busy === 'wallet' ? 'Waiting for wallet…' : 'Authenticate in World App'} <Arrow /></button>{!isInstalled && hasBrowserWallet && <button className="button-secondary" onClick={() => void connectBrowser()} disabled={!!busy}>Connect browser wallet <Arrow /></button>}</div><p className="step-footnote">{!isInstalled ? 'MiniKit authentication needs World App. An injected browser wallet can sign the World ID challenge.' : 'A wallet signature proves wallet control; human verification is a separate step.'}</p></div></article>
        <article className="step"><div className="step-number">02</div><div className="step-body"><div className="step-heading"><h2>Verify a human</h2><Status good={humanVerified}>{humanVerified ? 'Server verified' : 'Not verified'}</Status></div><p>Request a fresh proof of human, bound to this wallet. The server verifies the v4 proof and stores its nullifier once.</p><div className="actions"><button onClick={() => void beginVerification()} disabled={!!busy || !wallet || !config.worldIdReady || humanVerified}>{busy === 'world-id' ? 'Verification in progress…' : humanVerified ? 'Human verified' : 'Verify with World ID'} <Arrow /></button>{verifiedResult && <button className="button-secondary" onClick={exportProof}>Download private proof <Arrow /></button>}</div><p className="step-footnote">{verifiedResult ? 'The private proof stays in this tab until you download it. Use it before expiry; keep it out of git.' : 'Uses explicit credential constraints and wallet bytes. Legacy proofs are disabled.'}</p></div></article>
        <article className="step"><div className="step-number">03</div><div className="step-body"><div className="step-heading"><h2>Record a zero-value ping</h2><Status good={!!receipt}>{receipt ? 'Confirmed' : submission ? 'Submitted' : 'Not executed'}</Status></div><p>Call the configured ping contract with no token approval or native value. Confirmation requires the actual transaction receipt and your matching event.</p><div className="actions"><button onClick={() => void sendPing()} disabled={!!busy || !humanVerified || !isInstalled || !config.pingReady}>{busy === 'ping' ? 'Waiting for confirmation…' : 'Send zero-value ping'} <Arrow /></button>{submission && !receipt && <button className="button-secondary" onClick={() => { setBusy('ping'); void checkReceipt(submission, false).catch(caught => setError(explain(caught))).finally(() => setBusy(null)); }} disabled={!!busy}>Check receipt</button>}</div><p className="step-footnote">{!config.pingReady ? 'Requires a public WORLD_PING_ADDRESS and confirmed Portal allowlist. A fork deployment cannot be called from World App.' : `Target: ${config.pingAddress}. World App must allowlist this contract.`}</p></div></article>
      </section>

      <section className="proof-trail" aria-label="Proof trail"><div className="trail-heading"><h2>Proof trail</h2><span className="eyebrow">NO RECEIPT, NO SUCCESS CLAIM</span></div><p role="status" aria-live="polite">{message}</p>{error && <p className="error-message" role="alert">{error}</p>}{submission && <div className="receipt-line"><span>User operation</span><code>{submission.userOpHash}</code><span>Submission only</span></div>}{receipt && <div className="receipt-line"><span>Transaction</span><a href={`https://worldscan.org/tx/${receipt.transactionHash}`} target="_blank" rel="noreferrer">{receipt.transactionHash} <Arrow /></a><span>Confirmed · block {receipt.blockNumber}</span></div>}</section>

      <section id="setup" className="setup-guide"><div><p className="eyebrow">DEVELOPER SETUP</p><h2>Bring your own<br />Portal configuration.</h2><p>MiniKit, World ID, AgentKit, and Continuity are coverage components here. Tokyo's final World prize categories remain unpublished.</p></div><ol><li><strong>Configure the two apps.</strong><span>Use the <a href="https://developer.world.org" target="_blank" rel="noreferrer">Developer Portal</a> to create or select your Mini App and World ID app. Copy public IDs into the server environment; keep the RP signing key private.</span></li><li><strong>Use the right origin.</strong><span>Set WORLD_APP_ORIGIN to the exact URL opened in World App, including any development tunnel. Local setup currently expects <code>{config.origin}</code>.</span></li><li><strong>Allow the public contract.</strong><span>Deploy the zero-value ping contract on World Chain, add it to the Mini App's allowed contracts, then set WORLD_PING_ALLOWLIST_CONFIRMED=true.</span></li><li><strong>Complete the human steps.</strong><span>Open the configured Mini App in World App and approve each request yourself. Portal screenshots and live proof are pending an authenticated Portal session.</span></li></ol></section>
    </main><footer><span>Generic starter · MIT · Disclose prior art</span><a href="https://docs.world.org/world-id/idkit/mini-apps" target="_blank" rel="noreferrer">Official integration docs <Arrow /></a></footer>
    {challenge && walletSignature && <IDKitRequestWidget open={widgetOpen} onOpenChange={open => { setWidgetOpen(open); if (!open) setBusy(null); }}
      app_id={challenge.app_id} action={challenge.action} rp_context={challenge.rp_context} environment={challenge.environment}
      allow_legacy_proofs={false} constraints={{ type: 'proof_of_human', signal: hexToBytes(challenge.signal), expires_at_min: challenge.expiresAtMin, genesis_issued_at_min: challenge.genesisIssuedAtMin }}
      handleVerify={verifyOnServer} onSuccess={() => { setBusy(null); setWidgetOpen(false); }} onError={code => { setError(explain(new Error(code))); setBusy(null); }} />}
  </div>;
}
