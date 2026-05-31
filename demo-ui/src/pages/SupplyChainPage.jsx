import { Fragment, useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { SCENARIOS, FISCO_LOCAL_SAMPLES } from '../data/supply_chain_samples';

/* ── 常量 ── */
const QUERY_STAGE_ORDER = ['REQUEST_SENT', 'A_CHAIN_FETCHED', 'RESPONSE_SENT', 'COMPLETED'];
const RELAY_STAGES = [
  { key: 'REQUEST_SENT', label: 'FISCO 发起请求', node: 'FISCO' },
  { key: 'A_CHAIN_FETCHED', label: 'Relayer 查询 Fabric', node: 'Relayer' },
  { key: 'RESPONSE_SENT', label: 'Fabric 返回数据', node: 'Fabric' },
  { key: 'COMPLETED', label: '验证完成', node: 'FISCO' }
];

/* ── 工具函数 ── */
function formatMs(ms) { const n = Number(ms); if (!Number.isFinite(n) || n < 0) return '-'; return n < 1000 ? `${Math.round(n)}ms` : `${(n / 1000).toFixed(1)}s`; }

function getSessionStageIndex(session) {
  const idx = QUERY_STAGE_ORDER.indexOf(String(session?.status || '').toUpperCase());
  return idx >= 0 ? idx : 0;
}
function isSessionFinal(s) {
  const v = String(s?.verifyStatus || '').toUpperCase();
  if (v === 'PASS' || v === 'FAILED' || v === 'MISMATCH') return true;
  const st = String(s?.status || '').toUpperCase();
  return st === 'COMPLETED' || st === 'FAILED';
}
function getStageMetric(session, stage) {
  const steps = Array.isArray(session?.steps) ? session.steps : [];
  for (let i = steps.length - 1; i >= 0; i--) {
    if (String(steps[i]?.step || '').toUpperCase() === String(stage).toUpperCase()) {
      const e = steps[i]?.details?.elapsedFromRequestMs;
      if (Number.isFinite(e)) return e;
    }
  }
  return null;
}
function getTotalElapsed(session) {
  if (!session) return null;
  const completed = getStageMetric(session, 'COMPLETED');
  if (completed) return completed;
  for (let i = QUERY_STAGE_ORDER.length - 1; i >= 0; i--) {
    const m = getStageMetric(session, QUERY_STAGE_ORDER[i]);
    if (m) return m;
  }
  return null;
}

/** 从嵌套对象中按 dot-path 取值, e.g. "data.yieldForecast.estimatedTons" */
function getByPath(obj, path) {
  if (!obj || !path) return undefined;
  return path.split('.').reduce((o, k) => (o != null ? o[k] : undefined), obj);
}

/* ══════════════════════════════════════
   决策对比组件
   ══════════════════════════════════════ */
function DecisionComparison({ comparison, crossChainData }) {
  if (!comparison || !comparison.rules?.length) return null;

  return (
    <div className="sc-comparison-wrap">
      {comparison.rules.map((rule, i) => {
        const remoteRaw = crossChainData ? getByPath(crossChainData, rule.remoteField) : null;
        const hasRemote = remoteRaw != null;
        let remoteDisplay = hasRemote
          ? (rule.isPercent ? `${(remoteRaw * 100).toFixed(0)}%` : `${remoteRaw}${rule.remoteUnit || ''}`)
          : '???';
        if (rule.op === 'info' && hasRemote) remoteDisplay = String(remoteRaw);

        let verdict = null;
        if (hasRemote && rule.op !== 'info' && rule.localNum != null) {
          const remoteNum = Number(remoteRaw);
          if (Number.isFinite(remoteNum)) {
            if (rule.op === 'lte') verdict = rule.localNum <= remoteNum; // local need <= remote supply = ok
            else if (rule.op === 'gte') verdict = remoteNum < rule.localNum; // remote actual < local limit = ok (compliant)
          }
        }

        return (
          <div key={i} className="sc-comparison-row">
            <span className="sc-comparison-label">{rule.label}</span>
            <span className="sc-comparison-local">{rule.localValue}</span>
            <span className="sc-comparison-vs">vs</span>
            <span className={`sc-comparison-remote ${!hasRemote ? 'sc-comparison-pending' : ''}`}>{remoteDisplay}</span>
            {verdict != null && (
              <span className={verdict ? 'sc-comparison-pass' : 'sc-comparison-fail'}>
                {verdict ? 'PASS' : 'FAIL'}
              </span>
            )}
            {rule.op === 'info' && hasRemote && (
              <span className="sc-comparison-info">-</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════
   本地查询结果卡片 — 绿色脉冲
   ══════════════════════════════════════ */
function LocalResultCard({ record, elapsedMs }) {
  return (
    <div className="sc-local-result">
      <div className="sc-local-result-header">
        <span className="sc-category-badge">{record.category}</span>
        <span>{record.title}</span>
      </div>
      <div className="sc-local-timing">{Math.round(elapsedMs)}ms</div>
      <pre className="result" style={{ marginTop: 6, maxHeight: 140, fontSize: 11 }}>
        {JSON.stringify(record.data, null, 2)}
      </pre>
    </div>
  );
}

/* ══════════════════════════════════════
   跨链中继动画可视化
   ══════════════════════════════════════ */
function CrossChainRelayViz({ session }) {
  const curIdx = session ? getSessionStageIndex(session) : -1;
  const done = session && isSessionFinal(session);
  const elapsed = getTotalElapsed(session);

  return (
    <div className="sc-relay-viz">
      <div className="sc-relay-stages">
        {RELAY_STAGES.map((stage, i) => {
          const active = !done && i === curIdx;
          const completed = done || i < curIdx;
          const metric = session ? getStageMetric(session, stage.key) : null;
          return (
            <Fragment key={stage.key}>
              <div className={`sc-relay-node ${completed ? 'is-done' : ''} ${active ? 'is-active' : ''}`}>
                <div className="sc-relay-node-label">{stage.node}</div>
                <div className="sc-relay-node-desc">{stage.label}</div>
                {metric != null && <div className="sc-relay-node-time">{formatMs(metric)}</div>}
              </div>
              {i < RELAY_STAGES.length - 1 && (
                <div className={`sc-relay-arrow ${(completed || active) ? 'is-active' : ''}`}>
                  <span>&rarr;</span>
                </div>
              )}
            </Fragment>
          );
        })}
      </div>
      {elapsed != null && (
        <div className="sc-crosschain-timing">{formatMs(elapsed)}</div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   耗时对比条形图
   ══════════════════════════════════════ */
function TimingComparisonBar({ localTimings, crossChainTimings }) {
  const allTimings = [...localTimings, ...crossChainTimings].filter(t => t.ms > 0);
  if (!allTimings.length) return null;
  const maxMs = Math.max(...allTimings.map(t => t.ms), 100);

  return (
    <div className="sc-timing-bar-wrap">
      <h3>耗时对比</h3>
      <div className="sc-timing-bars">
        {localTimings.map((t, i) => (
          <div key={`local-${i}`} className="sc-timing-row">
            <span className="sc-timing-label">{t.label}</span>
            <div className="sc-timing-track">
              <div className="sc-timing-fill is-local" style={{ width: `${Math.max(1, (t.ms / maxMs) * 100)}%` }} />
            </div>
            <span className="sc-timing-value sc-local-timing-small">{formatMs(t.ms)}</span>
          </div>
        ))}
        {crossChainTimings.map((t, i) => (
          <div key={`cc-${i}`} className="sc-timing-row">
            <span className="sc-timing-label">{t.label}</span>
            <div className="sc-timing-track">
              <div className="sc-timing-fill is-crosschain" style={{ width: `${Math.max(1, (t.ms / maxMs) * 100)}%` }} />
            </div>
            <span className="sc-timing-value sc-crosschain-timing-small">{formatMs(t.ms)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════
   FISCO 本地数据卡片 — 左侧"我的数据"
   ══════════════════════════════════════ */
function FiscoLocalCard({ record, onLocalQuery, onCrossChainQuery, localResult, crossChainSession, crossChainData, queryLoading }) {
  const [showData, setShowData] = useState(false);
  const done = crossChainSession && isSessionFinal(crossChainSession);

  return (
    <div className="sc-fisco-card">
      <div className="sc-fisco-card-head" onClick={() => setShowData(!showData)} style={{ cursor: 'pointer' }}>
        <span className="sc-category-badge">{record.category}</span>
        <strong>{record.title}</strong>
        {record.needsCrossChainData && (
          <span className="sc-cross-chain-tag">需跨链</span>
        )}
        <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8fa3ce' }}>{showData ? '▼' : '▶'}</span>
      </div>
      {showData && (
        <pre className="result" style={{ marginTop: 8, maxHeight: 140, fontSize: 11 }}>
          {JSON.stringify(record.data, null, 2)}
        </pre>
      )}

      {/* 决策问题提示 */}
      {record.comparison && record.comparison.question && (
        <div className="sc-decision-question">
          {record.comparison.question}
        </div>
      )}

      <div className="sc-fisco-card-actions">
        <button type="button" className="sc-inline-btn sc-btn-local" onClick={() => onLocalQuery(record)}>
          本地查询
        </button>
        {record.needsCrossChainData && (
          <button
            type="button"
            className="sc-inline-btn sc-btn-crosschain"
            disabled={queryLoading}
            onClick={() => onCrossChainQuery(record)}
          >
            跨链获取生产数据
          </button>
        )}
      </div>

      {localResult && <LocalResultCard record={localResult.record} elapsedMs={localResult.elapsed} />}

      {/* 决策对比结果 */}
      {record.comparison && done && (
        <DecisionComparison comparison={record.comparison} crossChainData={crossChainData} />
      )}
    </div>
  );
}

/* ══════════════════════════════════════
   追溯链路可视化组件
   ══════════════════════════════════════ */
function TraceChainViz({ traceChain, queryResults }) {
  if (!Array.isArray(traceChain) || !traceChain.length) return null;
  return (
    <div className="sc-trace-chain">
      {traceChain.map((node, i) => {
        const result = queryResults?.[node.batchId];
        const done = result?.status === 'COMPLETED';
        const failed = result?.status === 'FAILED';
        const tone = done ? 'pass' : failed ? 'failed' : 'pending';
        return (
          <Fragment key={node.batchId}>
            <div className={`sc-trace-node sc-trace-${tone}`}>
              <div className="sc-trace-step">第{node.step}步</div>
              <div className="sc-trace-role">{node.role}</div>
              <div className="sc-trace-batch">{node.batchId}</div>
              {done && <span className="proof-badge status-pass" style={{ fontSize: 10 }}>已查</span>}
              {failed && <span className="proof-badge status-failed" style={{ fontSize: 10 }}>失败</span>}
            </div>
            {i < traceChain.length - 1 && <div className="sc-trace-arrow">&rarr;</div>}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ════════════════════════════════════════
   主页面 — 双链视角（FISCO左, Fabric右）
   ════════════════════════════════════════ */
export default function SupplyChainPage() {
  const [scenario, setScenario] = useState(SCENARIOS[0]);
  const [status, setStatus] = useState(null);
  const [orchardItems, setOrchardItems] = useState([]);
  const [fiscoItems, setFiscoItems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [seedLoading, setSeedLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const [localResults, setLocalResults] = useState({});
  const [crossChainMap, setCrossChainMap] = useState({});
  const [localTimings, setLocalTimings] = useState([]);
  const [crossChainTimings, setCrossChainTimings] = useState([]);
  const [traceResults, setTraceResults] = useState({});

  // 跨链返回的原始数据: { [queryId]: payload }
  const [crossChainPayloads, setCrossChainPayloads] = useState({});

  const fiscoSamples = FISCO_LOCAL_SAMPLES[scenario.id] || [];

  /* ── 刷新 ── */
  const refreshAll = useCallback(async () => {
    const [sResp, oResp, qResp, fResp] = await Promise.all([
      fetch('/api/demo/status'),
      fetch('/api/demo/app/orchard?limit=50'),
      fetch('/api/demo/app/query/sessions?limit=30'),
      fetch('/api/demo/app/fisco-local?limit=50')
    ]);
    if (sResp.ok) setStatus(await sResp.json());
    if (oResp.ok) { const d = await oResp.json(); setOrchardItems(Array.isArray(d.items) ? d.items : []); }
    if (qResp.ok) {
      const d = await qResp.json();
      setSessions(Array.isArray(d.items) ? d.items : []);
    }
    if (fResp.ok) { const d = await fResp.json(); setFiscoItems(Array.isArray(d.items) ? d.items : []); }
  }, []);

  useEffect(() => {
    let mounted = true;
    const tick = async () => { try { await refreshAll(); } catch {} };
    tick();
    const t = setInterval(() => { if (mounted) tick(); }, 5000);
    return () => { mounted = false; clearInterval(t); };
  }, [refreshAll]);

  /* SSE */
  useEffect(() => {
    const es = new EventSource('/api/demo/stream');
    es.onmessage = () => refreshAll().catch(() => {});
    return () => es.close();
  }, [refreshAll]);

  // 跟踪跨链查询完成，更新耗时 + 获取payload
  const prevSessionsRef = useRef([]);
  useEffect(() => {
    for (const [recordId, queryId] of Object.entries(crossChainMap)) {
      const s = sessions.find(sess => sess.queryId === queryId);
      if (s && isSessionFinal(s)) {
        const elapsed = getTotalElapsed(s);
        if (elapsed) {
          setCrossChainTimings(prev => {
            if (prev.some(t => t.queryId === queryId)) return prev;
            const rec = fiscoSamples.find(r => r.recordId === recordId) || {};
            return [...prev, { label: `跨链: ${rec.title || recordId}`, ms: elapsed, queryId }];
          });
        }
        // 从 session 中提取 crossChainData payload
        if (s.result?.payload && !crossChainPayloads[queryId]) {
          setCrossChainPayloads(prev => ({ ...prev, [queryId]: s.result.payload }));
        }
        // 也尝试从 orchardItems 匹配
        if (!crossChainPayloads[queryId]) {
          const rec = fiscoSamples.find(r => r.recordId === recordId);
          if (rec?.needsCrossChainData) {
            const oi = orchardItems.find(item => item.orchardBatchId === rec.needsCrossChainData);
            if (oi?.payload) {
              setCrossChainPayloads(prev => ({ ...prev, [queryId]: oi.payload }));
            }
          }
        }
      }
    }
    prevSessionsRef.current = sessions;
  }, [sessions, crossChainMap, fiscoSamples, orchardItems, crossChainPayloads]);

  // 追溯结果同步
  useEffect(() => {
    if (scenario.id !== 'safety-trace' || !Object.keys(traceResults).length) return;
    const updated = { ...traceResults };
    let changed = false;
    for (const [batchId, tr] of Object.entries(updated)) {
      if (tr.queryId) {
        const s = sessions.find(sess => sess.queryId === tr.queryId);
        if (s && s.status !== tr.status) {
          updated[batchId] = { ...tr, status: s.status };
          changed = true;
        }
      }
    }
    if (changed) setTraceResults(updated);
  }, [sessions, traceResults, scenario.id]);

  /* ── 一键写入两侧数据 ── */
  const handleSeedBoth = async () => {
    setSeedLoading(true); setError(''); setInfo('');
    const msgs = [];
    const errors = [];

    try {
      const resp = await fetch('/api/demo/app/supply-chain/seed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: scenario.records })
      });
      const data = await resp.json();
      if (data.successCount > 0) msgs.push(`Fabric: ${data.successCount}条`);
      else errors.push('Fabric写入失败');
    } catch (e) { errors.push(`Fabric: ${e.message}`); }

    if (fiscoSamples.length > 0) {
      try {
        const resp = await fetch('/api/demo/app/fisco-local/seed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ records: fiscoSamples })
        });
        const data = await resp.json();
        if (data.successCount > 0) msgs.push(`FISCO: ${data.successCount}条`);
        else errors.push('FISCO写入失败');
      } catch (e) { errors.push(`FISCO: ${e.message}`); }
    }

    if (msgs.length) setInfo(`写入成功 — ${msgs.join(', ')}${errors.length ? ` (部分失败: ${errors.join('; ')})` : ''}`);
    else setError(errors.join('; ') || '写入失败');
    await refreshAll().catch(() => {});
    setSeedLoading(false);
  };

  /* ── FISCO 本地查询 ── */
  const handleLocalQuery = useCallback(async (record) => {
    const start = performance.now();
    try {
      const resp = await fetch(`/api/demo/app/fisco-local/${encodeURIComponent(record.recordId)}`);
      const elapsed = performance.now() - start;
      if (resp.ok) {
        const data = await resp.json();
        setLocalResults(prev => ({ ...prev, [record.recordId]: { record: data.record, elapsed } }));
        setLocalTimings(prev => {
          if (prev.some(t => t.recordId === record.recordId)) return prev;
          return [...prev, { label: `本地: ${record.title}`, ms: elapsed, recordId: record.recordId }];
        });
      } else if (resp.status === 404) {
        setError('数据未写入，请先点击"一键初始化两侧数据"');
      }
    } catch (e) { setError(`本地查询失败: ${e.message}`); }
  }, []);

  /* ── 跨链查询 ── */
  const handleCrossChainQuery = useCallback(async (record) => {
    const batchId = record.needsCrossChainData;
    if (!batchId) return;
    try {
      setQueryLoading(true); setError('');
      const resp = await fetch('/api/demo/app/query/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orchardBatchId: batchId })
      });
      const data = await resp.json();
      if (!resp.ok || !data.success) throw new Error(data.error || '查询失败');
      setCrossChainMap(prev => ({ ...prev, [record.recordId]: data.queryId }));
      setInfo(`跨链查询已发起: ${batchId}`);
      await refreshAll();
    } catch (e) { setError(e.message); }
    finally { setQueryLoading(false); }
  }, [refreshAll]);

  /* ── 追溯查询 ── */
  const handleTraceQuery = async () => {
    const traceRecord = scenario.records.find(r => r.eventType === 'safety_trace_request');
    if (!traceRecord?.data?.traceChain) { setError('当前场景无追溯链路'); return; }
    const chain = traceRecord.data.traceChain;
    setTraceResults({});
    setInfo('开始逐环节追溯查询...');

    for (const node of chain) {
      try {
        const resp = await fetch('/api/demo/app/query/request', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orchardBatchId: node.batchId })
        });
        const data = await resp.json();
        setTraceResults(prev => ({ ...prev, [node.batchId]: { status: data.success ? 'STARTED' : 'FAILED', queryId: data.queryId } }));
      } catch {
        setTraceResults(prev => ({ ...prev, [node.batchId]: { status: 'FAILED' } }));
      }
    }
    setInfo('全部追溯查询已发起，等待跨链返回...');
    await refreshAll();
  };

  /* ── 场景数据 ── */
  const scenarioBatchIds = useMemo(() => new Set(scenario.records.map(r => r.orchardBatchId)), [scenario]);
  const onChainRecords = useMemo(() => orchardItems.filter(item => scenarioBatchIds.has(item.orchardBatchId)), [orchardItems, scenarioBatchIds]);
  const scenarioSessions = useMemo(() => sessions.filter(s => scenarioBatchIds.has(s.orchardBatchId)), [sessions, scenarioBatchIds]);
  const traceChain = scenario.id === 'safety-trace'
    ? scenario.records.find(r => r.eventType === 'safety_trace_request')?.data?.traceChain
    : null;

  /** 根据 recordId 获取跨链返回的原始数据 */
  const getCrossChainData = (recordId) => {
    const queryId = crossChainMap[recordId];
    if (!queryId) return null;
    if (crossChainPayloads[queryId]) return crossChainPayloads[queryId];
    // fallback: 从 orchardItems 查
    const rec = fiscoSamples.find(r => r.recordId === recordId);
    if (rec?.needsCrossChainData) {
      const oi = orchardItems.find(item => item.orchardBatchId === rec.needsCrossChainData);
      return oi?.payload || null;
    }
    return null;
  };

  const switchScenario = (s) => {
    setScenario(s);
    setLocalResults({});
    setCrossChainMap({});
    setCrossChainPayloads({});
    setLocalTimings([]);
    setCrossChainTimings([]);
    setTraceResults({});
    setInfo('');
    setError('');
  };

  return (
    <main className="page">
      {/* ── Hero ── */}
      <header className="hero">
        <h1>双链视角供应链演示</h1>
        <p>不同行业的数据天然归属不同链，跨链查询用于业务决策和监管审计</p>
        {error && <p className="error">{error}</p>}
        {info && <p className="muted">{info}</p>}
      </header>

      {/* ── 场景选择器 ── */}
      <section className="sc-scenario-bar">
        {SCENARIOS.map(s => (
          <button
            key={s.id}
            type="button"
            className={`sc-scenario-btn ${scenario.id === s.id ? 'sc-active' : ''}`}
            style={{ '--sc-color': s.color }}
            onClick={() => switchScenario(s)}
          >
            <span className="sc-scenario-icon">{s.icon}</span>
            <span className="sc-scenario-title">{s.title}</span>
            <span className="sc-scenario-sub">{s.subtitle}</span>
          </button>
        ))}
      </section>

      {/* ── 场景故事 + 一键初始化 ── */}
      <div className="sc-story card">
        <div className="sc-story-text">{scenario.story}</div>
        <div className="button-row">
          <button type="button" onClick={handleSeedBoth} disabled={seedLoading}>
            {seedLoading ? '写入中...' : '一键初始化两侧数据'}
          </button>
        </div>
      </div>

      {/* ── 左右分栏：FISCO(左) / Fabric(右) ── */}
      <section className="grid two">
        {/* 左：FISCO 我的数据 */}
        <article className="card">
          <h2 className="sc-chain-header sc-fisco-header">FISCO · 我的数据</h2>
          <div className="sc-my-data-header">
            {scenario.fiscoOwner} ({scenario.fiscoRole})
          </div>

          {scenario.id === 'safety-trace' ? (
            <>
              {fiscoSamples.map(record => (
                <FiscoLocalCard
                  key={record.recordId}
                  record={record}
                  onLocalQuery={handleLocalQuery}
                  onCrossChainQuery={handleCrossChainQuery}
                  localResult={localResults[record.recordId]}
                  crossChainSession={crossChainMap[record.recordId] ? sessions.find(s => s.queryId === crossChainMap[record.recordId]) : null}
                  crossChainData={getCrossChainData(record.recordId)}
                  queryLoading={queryLoading}
                />
              ))}
              <div className="button-row" style={{ marginTop: 8 }}>
                <button type="button" onClick={handleTraceQuery} disabled={queryLoading}>
                  {queryLoading ? '追溯中...' : '启动全链追溯 (4次跨链)'}
                </button>
              </div>
              {traceChain && <TraceChainViz traceChain={traceChain} queryResults={traceResults} />}
            </>
          ) : (
            fiscoSamples.map(record => (
              <FiscoLocalCard
                key={record.recordId}
                record={record}
                onLocalQuery={handleLocalQuery}
                onCrossChainQuery={handleCrossChainQuery}
                localResult={localResults[record.recordId]}
                crossChainSession={crossChainMap[record.recordId] ? sessions.find(s => s.queryId === crossChainMap[record.recordId]) : null}
                crossChainData={getCrossChainData(record.recordId)}
                queryLoading={queryLoading}
              />
            ))
          )}
        </article>

        {/* 右：Fabric 生产链数据 */}
        <article className="card">
          <h2 className="sc-chain-header sc-fabric-header">Fabric · 生产链数据</h2>
          <div className="sc-their-data-header">
            {scenario.fabricOwner} ({scenario.fabricRole})
          </div>

          <div className="sc-record-list">
            {scenario.records.map(r => {
              const onChain = orchardItems.some(item => item.orchardBatchId === r.orchardBatchId);
              return (
                <div key={r.orchardBatchId} className={`sc-data-card ${onChain ? 'sc-on-chain' : ''}`}>
                  <div className="sc-data-card-head">
                    <strong>{r.orchardBatchId}</strong>
                    <span className="muted" style={{ fontSize: 12 }}>{r.data?.farmName || r.data?.factoryName || r.data?.carrier || r.data?.retailer || r.eventType}</span>
                    {onChain && <span className="proof-badge status-pass" style={{ fontSize: 10, marginLeft: 6 }}>链上</span>}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 跨链中继动画 */}
          {scenarioSessions.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3>跨链中继状态</h3>
              {scenarioSessions.map(item => {
                const done = isSessionFinal(item);
                return (
                  <div key={item.queryId} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 12, color: '#8fa3ce', marginBottom: 4 }}>{item.orchardBatchId}</div>
                    <CrossChainRelayViz session={item} />
                  </div>
                );
              })}
            </div>
          )}

          {/* 跨链返回的原始数据 */}
          {Object.keys(crossChainPayloads).length > 0 && (
            <div style={{ marginTop: 14 }}>
              <h3>跨链返回的原始数据</h3>
              {Object.entries(crossChainPayloads).map(([qid, payload]) => (
                <pre key={qid} className="result" style={{ maxHeight: 160, fontSize: 11 }}>
                  {JSON.stringify(payload, null, 2)}
                </pre>
              ))}
            </div>
          )}
        </article>
      </section>

      {/* ── 底部耗时对比 ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <TimingComparisonBar localTimings={localTimings} crossChainTimings={crossChainTimings} />
        {localTimings.length === 0 && crossChainTimings.length === 0 && (
          <p className="muted" style={{ textAlign: 'center' }}>点击"本地查询"或"跨链获取生产数据"后，此处将显示耗时对比</p>
        )}
      </section>

      {/* ── 事件时间线 ── */}
      <section className="card" style={{ marginTop: 16 }}>
        <h2>跨链事件时间线</h2>
        <EventTimeline />
      </section>
    </main>
  );
}

/* ── 事件时间线（复用 SSE） ── */
function EventTimeline() {
  const [events, setEvents] = useState([]);

  useEffect(() => {
    const es = new EventSource('/api/demo/stream');
    es.onmessage = (evt) => {
      try {
        const item = JSON.parse(evt.data);
        setEvents(prev => {
          const next = [item, ...prev];
          return next.length > 50 ? next.slice(0, 50) : next;
        });
      } catch {}
    };
    return () => es.close();
  }, []);

  useEffect(() => {
    fetch('/api/demo/events?limit=30').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setEvents(d.reverse());
      else if (Array.isArray(d.items)) setEvents(d.items.reverse());
    }).catch(() => {});
  }, []);

  if (!events.length) return <p className="muted">暂无事件</p>;

  return (
    <div className="timeline" style={{ maxHeight: 240 }}>
      {events.map((e, i) => (
        <div key={e.id || i} className={`timeline-item ${e.level === 'error' ? 'error-item' : ''}`}>
          <div className="timeline-meta">
            <span>{e.ts || ''}</span>
            <span>{e.direction || ''}</span>
            <span>{e.relayState || e.type || ''}</span>
          </div>
          <div className="muted" style={{ fontSize: 12 }}>{e.message || JSON.stringify(e.data || {}).slice(0, 120)}</div>
        </div>
      ))}
    </div>
  );
}
