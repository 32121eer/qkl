import { useEffect, useMemo, useState } from 'react';

const DEFAULT_ORCHARD_DATA = {
  payloadVersion: '1.0',
  orchardBatchId: 'BATCH-APPLE-0001',
  eventType: 'cultivation',
  eventAt: new Date().toISOString(),
  sourceSystem: 'orchard-iot',
  dataText: JSON.stringify(
    {
      orchardName: 'Apple Garden A',
      soilTemperature: 21.8,
      soilMoisture: 44.2,
      rainFall: 2.3
    },
    null,
    2
  )
};

function toPrettyJson(value) {
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

function parseJsonText(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: null, error: error.message };
  }
}

function formatDirectionLabel(direction) {
  if (direction === 'FABRIC_TO_FISCO') return 'Fabric -> FISCO';
  if (direction === 'FISCO_TO_FABRIC') return 'FISCO -> Fabric';
  return direction || '未知方向';
}

function summarizeTimelineSource(item) {
  const sourceBlockNumber =
    item?.data?.sourceBlockNumber ??
    item?.data?.blockNumber ??
    item?.data?.event?.blockNumber;

  if (sourceBlockNumber === undefined || sourceBlockNumber === null) {
    return null;
  }
  return String(sourceBlockNumber);
}

function formatProofStatusLabel(status) {
  if (status === 'PASS') return 'PASS';
  if (status === 'MISMATCH') return 'MISMATCH';
  if (status === 'FAILED') return 'FAILED';
  return 'PENDING';
}

function shortenHash(value) {
  if (!value || typeof value !== 'string') return '-';
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function formatStatusFlag(value) {
  return value ? '已连接' : '未连接';
}

function formatStreamState(state) {
  if (state === 'connected') return '已连接';
  if (state === 'reconnecting') return '重连中';
  return '连接中';
}

export default function AppDemoPage() {
  const [status, setStatus] = useState(null);
  const [events, setEvents] = useState([]);
  const [mode, setMode] = useState('orchard-v1');
  const [orchard, setOrchard] = useState(DEFAULT_ORCHARD_DATA);
  const [rawJson, setRawJson] = useState('{\n  "message": "demo payload",\n  "timestamp": 0\n}');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [streamState, setStreamState] = useState('connecting');
  const [lastResult, setLastResult] = useState(null);
  const [proofCards, setProofCards] = useState([]);
  const [proofError, setProofError] = useState('');

  const fallbackUrl = useMemo(() => {
    if (status?.windowsAccess?.fallbackCandidates?.length) {
      return status.windowsAccess.fallbackCandidates[0];
    }
    return `http://${window.location.hostname}:15173`;
  }, [status]);

  const refreshStatus = async () => {
    const resp = await fetch('/api/demo/status');
    if (!resp.ok) {
      throw new Error(`status request failed: ${resp.status}`);
    }
    const data = await resp.json();
    setStatus(data);
  };

  const refreshEvents = async () => {
    const resp = await fetch('/api/demo/events?limit=200');
    if (!resp.ok) {
      throw new Error(`events request failed: ${resp.status}`);
    }
    const data = await resp.json();
    setEvents(Array.isArray(data.items) ? data.items : []);
  };

  const refreshProofCards = async () => {
    const resp = await fetch('/api/demo/app/proof-cards?limit=20');
    if (!resp.ok) {
      throw new Error(`proof cards request failed: ${resp.status}`);
    }
    const data = await resp.json();
    setProofCards(Array.isArray(data.items) ? data.items : []);
  };

  useEffect(() => {
    let timer = null;
    let mounted = true;

    const tick = async () => {
      try {
        await Promise.all([refreshStatus(), refreshEvents(), refreshProofCards()]);
        if (!mounted) return;
        setError('');
        setProofError('');
      } catch (err) {
        if (!mounted) return;
        const message = err?.message || String(err);
        if (message.includes('proof cards')) {
          setProofError(message);
        } else {
          setError(message);
        }
      }
    };

    tick();
    timer = setInterval(() => {
      tick().catch(() => {});
    }, 5000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    const es = new EventSource('/api/demo/stream');
    es.onopen = () => setStreamState('connected');
    es.onmessage = (evt) => {
      try {
        const item = JSON.parse(evt.data);
        setEvents((prev) => {
          const next = [...prev, item];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
        refreshProofCards().catch(() => {});
      } catch (_error) {
        // Ignore malformed event payload.
      }
    };
    es.onerror = () => {
      setStreamState('reconnecting');
    };
    return () => {
      es.close();
    };
  }, []);

  const buildPayload = () => {
    if (mode === 'raw-json') {
      const parsed = parseJsonText(rawJson);
      if (parsed.error) {
        throw new Error(`Raw JSON invalid: ${parsed.error}`);
      }
      return {
        payloadMode: 'raw-json',
        payload: parsed.value
      };
    }

    const parsedData = parseJsonText(orchard.dataText);
    if (parsedData.error) {
      throw new Error(`Orchard data JSON invalid: ${parsedData.error}`);
    }

    return {
      payloadMode: 'orchard-v1',
      payload: {
        payloadVersion: orchard.payloadVersion,
        orchardBatchId: orchard.orchardBatchId,
        eventType: orchard.eventType,
        eventAt: orchard.eventAt,
        sourceSystem: orchard.sourceSystem,
        data: parsedData.value
      }
    };
  };

  const trigger = async (direction) => {
    try {
      setLoading(true);
      setError('');

      const body = buildPayload();
      const endpoint =
        direction === 'FABRIC_TO_FISCO'
          ? '/api/demo/trigger/fabric-to-fisco'
          : '/api/demo/trigger/fisco-to-fabric';

      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      if (!resp.ok || data.success === false) {
        throw new Error(data.error || `Trigger failed: ${resp.status}`);
      }

      setLastResult(data);
      await Promise.all([refreshStatus(), refreshEvents(), refreshProofCards()]);
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  };

  const chains = status?.relayer?.chains || [];
  const fabric = chains.find((item) => item.chainId === 'FABRIC_NET_01');
  const fisco = chains.find((item) => item.chainId === 'FISCO_NET_01');
  const activeTriggers = status?.activeTriggers || [];
  const applicationFlow = [...events]
    .reverse()
    .filter((item) => item.direction === 'FABRIC_TO_FISCO' || item.direction === 'FISCO_TO_FABRIC');

  return (
    <main className="page">
      <header className="hero">
        <h1>应用触发演示（调试）</h1>
        <p>用于调试触发链路、回执结果和应用层事件流</p>
        <div className="url-row">
          <span>Windows 地址: http://localhost:15173/app-demo</span>
          <span>备用地址: {fallbackUrl}/app-demo</span>
          <span>实时通道: {formatStreamState(streamState)}</span>
        </div>
      </header>

      <section className="grid two">
        <article className="card">
          <h2>触发跨链</h2>
          <div className="mode-toggle">
            <button
              className={mode === 'orchard-v1' ? 'active' : ''}
              onClick={() => setMode('orchard-v1')}
              type="button"
            >
              苹果园载荷 V1
            </button>
            <button
              className={mode === 'raw-json' ? 'active' : ''}
              onClick={() => setMode('raw-json')}
              type="button"
            >
              原始 JSON
            </button>
          </div>

          {mode === 'orchard-v1' ? (
            <div className="form-grid">
              <label>
                payloadVersion
                <input
                  value={orchard.payloadVersion}
                  onChange={(e) => setOrchard((prev) => ({ ...prev, payloadVersion: e.target.value }))}
                />
              </label>
              <label>
                orchardBatchId
                <input
                  value={orchard.orchardBatchId}
                  onChange={(e) => setOrchard((prev) => ({ ...prev, orchardBatchId: e.target.value }))}
                />
              </label>
              <label>
                eventType
                <input
                  value={orchard.eventType}
                  onChange={(e) => setOrchard((prev) => ({ ...prev, eventType: e.target.value }))}
                />
              </label>
              <label>
                eventAt
                <input
                  value={orchard.eventAt}
                  onChange={(e) => setOrchard((prev) => ({ ...prev, eventAt: e.target.value }))}
                />
              </label>
              <label>
                sourceSystem
                <input
                  value={orchard.sourceSystem}
                  onChange={(e) => setOrchard((prev) => ({ ...prev, sourceSystem: e.target.value }))}
                />
              </label>
              <label className="wide">
                data（JSON）
                <textarea
                  rows={6}
                  value={orchard.dataText}
                  onChange={(e) => setOrchard((prev) => ({ ...prev, dataText: e.target.value }))}
                />
              </label>
            </div>
          ) : (
            <label>
              原始载荷 JSON
              <textarea rows={10} value={rawJson} onChange={(e) => setRawJson(e.target.value)} />
            </label>
          )}

          <div className="button-row">
            <button type="button" onClick={() => trigger('FABRIC_TO_FISCO')} disabled={loading}>
              Fabric -&gt; FISCO
            </button>
            <button type="button" onClick={() => trigger('FISCO_TO_FABRIC')} disabled={loading}>
              FISCO -&gt; Fabric
            </button>
          </div>
          {error ? <p className="error">{error}</p> : null}
          {lastResult ? <pre className="result">{toPrettyJson(lastResult)}</pre> : null}
        </article>

        <article className="card">
          <h2>执行状态</h2>
          <div className="status-row">
            <div>
              <h3>Fabric</h3>
              <p>{formatStatusFlag(Boolean(fabric?.isConnected))}</p>
              <small>最新区块: {fabric?.latestBlock ?? '-'}</small>
            </div>
            <div>
              <h3>FISCO</h3>
              <p>{formatStatusFlag(Boolean(fisco?.isConnected))}</p>
              <small>最新区块: {fisco?.latestBlock ?? '-'}</small>
            </div>
          </div>
          <div className="runtime-list">
            <div>
              <strong>活跃触发:</strong> {activeTriggers.length ? activeTriggers.join(', ') : '无'}
            </div>
            <div>
              <strong>最近应用事件:</strong> {applicationFlow.length}
            </div>
          </div>
        </article>
      </section>

      <section className="card">
        <h2>跨链对账卡</h2>
        {proofError ? <p className="error">{proofError}</p> : null}
        <div className="proof-list">
          {proofCards.length === 0 ? <p className="muted">暂无对账卡</p> : null}
          {proofCards.map((card) => (
            <details key={card.cardId} className={`proof-card proof-${String(card.status || '').toLowerCase()}`}>
              <summary className="proof-summary">
                <span>{formatDirectionLabel(card.direction)}</span>
                <span className={`proof-status status-${String(card.status || '').toLowerCase()}`}>
                  {formatProofStatusLabel(card.status)}
                </span>
                <span>{card.requestTs || '-'}</span>
              </summary>
              <div className="proof-columns">
                <div className="proof-side">
                  <h4>源链</h4>
                  <div>链: {card.source?.chainId || '-'}</div>
                  <div>交易: {shortenHash(card.source?.txHash)}</div>
                  <div>区块: {card.source?.blockNumber ?? '-'}</div>
                  <div>载荷哈希: {shortenHash(card.source?.payloadHash)}</div>
                  <div className="proof-preview">载荷: {card.source?.payloadPreview || '-'}</div>
                </div>
                <div className="proof-middle">
                  <div className={`proof-badge status-${String(card.status || '').toLowerCase()}`}>{formatProofStatusLabel(card.status)}</div>
                  <div>哈希一致: {card.verify?.hashEqual === null ? '-' : String(card.verify?.hashEqual)}</div>
                  <div>区块头验证: {card.verify?.blockHeaderVerified === null ? '-' : String(card.verify?.blockHeaderVerified)}</div>
                  <div>错误码: {card.verify?.errorCode || '-'}</div>
                </div>
                <div className="proof-side">
                  <h4>目标链</h4>
                  <div>链: {card.target?.chainId || '-'}</div>
                  <div>交易: {shortenHash(card.target?.txHash)}</div>
                  <div>区块: {card.target?.blockNumber ?? '-'}</div>
                  <div>载荷哈希: {shortenHash(card.target?.payloadHash)}</div>
                  <div>回执: {card.target?.receiptStatus || '-'}</div>
                </div>
              </div>
            </details>
          ))}
        </div>
      </section>

      <section className="card">
        <h2>应用流程</h2>
        <div className="timeline">
          {applicationFlow.length === 0 ? <p className="muted">暂无应用流程事件</p> : null}
          {applicationFlow.map((item) => (
            <div key={item.id} className={`timeline-item ${item.level === 'error' ? 'error-item' : ''}`}>
              <div className="timeline-meta">
                <span>{item.ts}</span>
                <span>{formatDirectionLabel(item.direction)}</span>
                <span>{item.relayState}</span>
                {summarizeTimelineSource(item) ? <span>源区块 #{summarizeTimelineSource(item)}</span> : null}
                {item.errorCode ? <span>{item.errorCode}</span> : null}
              </div>
              <div>{item.message}</div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
