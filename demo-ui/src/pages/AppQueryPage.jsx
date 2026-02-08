import { Fragment, useEffect, useMemo, useState } from 'react';

const STORAGE_KEYS = {
  batchId: 'app_query_batch_id',
  importedFileName: 'app_query_imported_file_name',
  importedRecords: 'app_query_imported_records',
  selectedImportIndex: 'app_query_selected_import_index',
  selectedSessionId: 'app_query_selected_session_id'
};

const DEFAULT_BATCH_ID = 'BATCH-APPLE-0001';
const QUERY_STAGE_ORDER = ['REQUEST_SENT', 'A_CHAIN_FETCHED', 'RESPONSE_SENT', 'COMPLETED'];
const QUERY_STAGE_LABEL = {
  REQUEST_SENT: '请求',
  A_CHAIN_FETCHED: '查询A链',
  RESPONSE_SENT: '返回中',
  COMPLETED: '完成'
};

function parseTimeMs(value) {
  const ms = Date.parse(String(value || ''));
  return Number.isNaN(ms) ? null : ms;
}

function shorten(value) {
  if (!value || typeof value !== 'string') return '-';
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}...${value.slice(-8)}`;
}

function formatQueryStatus(status) {
  if (status === 'COMPLETED') return '已完成';
  if (status === 'FAILED') return '失败';
  if (status === 'A_CHAIN_FETCHED') return 'A链已查询';
  if (status === 'RESPONSE_SENT') return '响应已发回';
  if (status === 'REQUEST_SENT') return '请求已发起';
  return status || '-';
}

function getSessionBadgeTone(session) {
  const verify = String(session?.verifyStatus || '').toUpperCase();
  if (verify === 'PASS') return 'pass';
  if (verify === 'FAILED') return 'failed';
  if (verify === 'MISMATCH') return 'mismatch';
  const status = String(session?.status || '').toUpperCase();
  if (status === 'COMPLETED') return 'pass';
  if (status === 'FAILED') return 'failed';
  return 'pending';
}

function getSessionBadgeText(session) {
  const verify = String(session?.verifyStatus || '').toUpperCase();
  if (verify === 'PASS' || verify === 'FAILED' || verify === 'MISMATCH') {
    return verify;
  }
  return formatQueryStatus(session?.status);
}

function getSessionStageIndex(session) {
  const status = String(session?.status || '').toUpperCase();
  const directIndex = QUERY_STAGE_ORDER.indexOf(status);
  if (directIndex >= 0) return directIndex;

  const steps = Array.isArray(session?.steps) ? session.steps : [];
  let maxIndex = 0;
  for (const step of steps) {
    const idx = QUERY_STAGE_ORDER.indexOf(String(step?.step || '').toUpperCase());
    if (idx > maxIndex) maxIndex = idx;
  }
  return maxIndex;
}

function isSessionFinal(session) {
  const verify = String(session?.verifyStatus || '').toUpperCase();
  if (verify === 'PASS' || verify === 'FAILED' || verify === 'MISMATCH') return true;
  const status = String(session?.status || '').toUpperCase();
  return status === 'COMPLETED' || status === 'FAILED';
}

function formatElapsed(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value < 0) return '-';
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

function getStageMetric(session, stage) {
  const stageMetric = session?.stepMetrics?.[stage];
  if (stageMetric && Number.isFinite(stageMetric.elapsedFromRequestMs)) {
    return stageMetric.elapsedFromRequestMs;
  }

  const steps = Array.isArray(session?.steps) ? session.steps : [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (String(step?.step || '').toUpperCase() !== String(stage).toUpperCase()) {
      continue;
    }
    const elapsed = step?.details?.elapsedFromRequestMs;
    if (Number.isFinite(elapsed)) {
      return elapsed;
    }
  }

  const requestAt = parseTimeMs(session?.requestTs);
  if (requestAt === null) return null;

  let stageAt = null;
  for (const step of steps) {
    if (String(step?.step || '').toUpperCase() !== String(stage).toUpperCase()) {
      continue;
    }
    const current = parseTimeMs(step?.ts);
    if (current !== null && (stageAt === null || current > stageAt)) {
      stageAt = current;
    }
  }

  if (stageAt === null && String(session?.status || '').toUpperCase() === String(stage).toUpperCase()) {
    stageAt = parseTimeMs(session?.updatedAt) ?? parseTimeMs(session?.settleTs);
  }

  if (stageAt === null) return null;
  return Math.max(0, stageAt - requestAt);
}

function buildStageElapsedSummary(session) {
  if (!session) return '-';
  return QUERY_STAGE_ORDER.map((stage, index) => {
    const elapsed = getStageMetric(session, stage);
    return `${index + 1}:${formatElapsed(elapsed)}`;
  }).join(' | ');
}

function QueryStatusBar({ session, compact = false }) {
  if (!session) {
    return <span className="proof-badge status-pending">等待中</span>;
  }

  const final = isSessionFinal(session);
  const badgeTone = getSessionBadgeTone(session);
  const badgeText = getSessionBadgeText(session);
  if (final) {
    return <span className={`proof-badge status-${badgeTone}`}>{badgeText}</span>;
  }

  const currentIndex = getSessionStageIndex(session);

  if (!compact) {
    return (
      <div className="query-progress query-progress-textual">
        {QUERY_STAGE_ORDER.map((step, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          const stageClass = done ? 'is-done' : active ? 'is-active' : '';
          return (
            <div key={step} className={`query-progress-step ${stageClass}`}>
              <span className="query-progress-dot" />
              <span className="query-progress-text">{QUERY_STAGE_LABEL[step]}</span>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={`query-progress query-progress-numeric ${compact ? 'query-progress-compact' : ''}`}>
      {QUERY_STAGE_ORDER.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        const stageClass = done ? 'is-done' : active ? 'is-active' : '';
        const stageTitle = `${index + 1}. ${QUERY_STAGE_LABEL[step]}`;
        return (
          <Fragment key={step}>
            <div className={`query-progress-step ${stageClass}`} title={stageTitle}>
              <span className="query-progress-index">{index + 1}</span>
            </div>
            {index < QUERY_STAGE_ORDER.length - 1 ? (
              <span className="query-progress-arrow" aria-hidden="true">→</span>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}

function parseJson(text) {
  try {
    return { value: JSON.parse(text), error: null };
  } catch (error) {
    return { value: null, error: error.message };
  }
}

function pickImportedRecords(root) {
  if (Array.isArray(root)) return root;
  if (!root || typeof root !== 'object') return [];
  if (Array.isArray(root.items)) return root.items;
  if (Array.isArray(root.records)) return root.records;
  if (Array.isArray(root.data)) return root.data;
  return [root];
}

function normalizeImportedPayload(record, index) {
  const source = record && typeof record === 'object' ? record : {};
  const payload = source.payload && typeof source.payload === 'object' ? source.payload : source;
  const fallbackBatchId = `BATCH-IMPORT-${index + 1}`;
  const rawBatchId = payload.orchardBatchId ?? payload.batchId ?? payload.id ?? fallbackBatchId;
  const orchardBatchId = String(rawBatchId || fallbackBatchId).trim() || fallbackBatchId;
  const eventType = String(payload.eventType || 'cultivation');
  const eventAt = payload.eventAt || new Date().toISOString();
  const sourceSystem = payload.sourceSystem || 'external-json';

  const knownKeys = new Set([
    'payload',
    'payloadVersion',
    'orchardBatchId',
    'batchId',
    'id',
    'eventType',
    'eventAt',
    'sourceSystem',
    'data'
  ]);
  const fallbackData = Object.fromEntries(
    Object.entries(payload).filter(([key]) => !knownKeys.has(key))
  );
  const data = payload.data && typeof payload.data === 'object' ? payload.data : fallbackData;

  return {
    payloadVersion: String(payload.payloadVersion || '1.0'),
    orchardBatchId,
    eventType,
    eventAt,
    sourceSystem,
    data: data && typeof data === 'object' ? data : {}
  };
}

function readPersistedRecords() {
  const raw = localStorage.getItem(STORAGE_KEYS.importedRecords);
  if (!raw) return [];
  const parsed = parseJson(raw);
  if (parsed.error || !Array.isArray(parsed.value)) return [];
  return parsed.value;
}

function readPersistedNumber(key, fallback = 0) {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function readPersistedString(key, fallback = '') {
  const raw = localStorage.getItem(key);
  if (raw === null || raw === undefined) return fallback;
  return String(raw);
}

export default function AppQueryPage() {
  const [status, setStatus] = useState(null);
  const [batchId, setBatchId] = useState(readPersistedString(STORAGE_KEYS.batchId, DEFAULT_BATCH_ID));
  const [orchardItems, setOrchardItems] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [queryLoading, setQueryLoading] = useState(false);
  const [upsertLoading, setUpsertLoading] = useState(false);
  const [error, setError] = useState('');
  const [queryError, setQueryError] = useState('');
  const [importError, setImportError] = useState('');
  const [info, setInfo] = useState('');
  const [importedFileName, setImportedFileName] = useState(
    readPersistedString(STORAGE_KEYS.importedFileName, '')
  );
  const [importedRecords, setImportedRecords] = useState(readPersistedRecords());
  const [selectedImportIndex, setSelectedImportIndex] = useState(
    readPersistedNumber(STORAGE_KEYS.selectedImportIndex, 0)
  );
  const [selectedSessionId, setSelectedSessionId] = useState(
    readPersistedString(STORAGE_KEYS.selectedSessionId, '')
  );

  const fallbackUrl = useMemo(() => {
    if (status?.windowsAccess?.fallbackCandidates?.length) {
      return status.windowsAccess.fallbackCandidates[0];
    }
    return `http://${window.location.hostname}:15173`;
  }, [status]);

  const selectedImportedRecord = importedRecords[selectedImportIndex] || null;
  const selectedSession = sessions.find((item) => item.queryId === selectedSessionId) || sessions[0] || null;
  const selectedSessionBadgeText = getSessionBadgeText(selectedSession);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.batchId, batchId);
  }, [batchId]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.importedFileName, importedFileName || '');
  }, [importedFileName]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.importedRecords, JSON.stringify(importedRecords));
  }, [importedRecords]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedImportIndex, String(selectedImportIndex));
  }, [selectedImportIndex]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.selectedSessionId, selectedSessionId || '');
  }, [selectedSessionId]);

  const refreshAll = async () => {
    const [statusResp, orchardResp, sessionsResp] = await Promise.all([
      fetch('/api/demo/status'),
      fetch('/api/demo/app/orchard?limit=20'),
      fetch('/api/demo/app/query/sessions?limit=30')
    ]);

    if (!statusResp.ok) throw new Error(`status request failed: ${statusResp.status}`);
    if (!orchardResp.ok) throw new Error(`orchard request failed: ${orchardResp.status}`);
    if (!sessionsResp.ok) throw new Error(`query sessions request failed: ${sessionsResp.status}`);

    const statusData = await statusResp.json();
    const orchardData = await orchardResp.json();
    const sessionsData = await sessionsResp.json();
    const sessionItems = Array.isArray(sessionsData.items) ? sessionsData.items : [];

    setStatus(statusData);
    setOrchardItems(Array.isArray(orchardData.items) ? orchardData.items : []);
    setSessions(sessionItems);
    setSelectedSessionId((prev) => {
      if (!sessionItems.length) return '';
      if (prev && sessionItems.some((item) => item.queryId === prev)) return prev;
      return sessionItems[0].queryId;
    });
  };

  useEffect(() => {
    let mounted = true;
    let timer = null;

    const tick = async () => {
      try {
        await refreshAll();
        if (!mounted) return;
        setError('');
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || String(err));
      }
    };

    setLoading(true);
    tick().finally(() => setLoading(false));
    timer = setInterval(() => {
      tick().catch(() => {});
    }, 5000);

    return () => {
      mounted = false;
      if (timer) clearInterval(timer);
    };
  }, []);

  const handleImportJsonFile = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    try {
      setImportError('');
      setInfo('');
      const text = await file.text();
      const parsed = parseJson(text);
      if (parsed.error) {
        throw new Error(`JSON解析失败: ${parsed.error}`);
      }

      const candidates = pickImportedRecords(parsed.value);
      if (!candidates.length) {
        throw new Error('JSON中未找到可用记录');
      }

      const normalized = candidates.map((record, index) => normalizeImportedPayload(record, index));
      setImportedRecords(normalized);
      setImportedFileName(file.name);
      setSelectedImportIndex(0);
      setBatchId(normalized[0].orchardBatchId);
      setInfo(`已导入 ${normalized.length} 条记录，来源文件：${file.name}`);
    } catch (err) {
      setImportError(err?.message || String(err));
    }
  };

  const handleUseImportedRecord = (indexValue) => {
    const index = Number.parseInt(indexValue, 10);
    if (Number.isNaN(index) || index < 0 || index >= importedRecords.length) {
      return;
    }
    setSelectedImportIndex(index);
    setBatchId(importedRecords[index].orchardBatchId);
  };

  const handleUpsert = async () => {
    try {
      setUpsertLoading(true);
      setError('');
      setImportError('');
      const cleanBatchId = String(batchId || '').trim();
      if (!cleanBatchId) {
        throw new Error('orchardBatchId 不能为空');
      }

      const payload = selectedImportedRecord
        ? { ...selectedImportedRecord, orchardBatchId: cleanBatchId }
        : normalizeImportedPayload({ orchardBatchId: cleanBatchId }, 0);

      const resp = await fetch('/api/demo/app/orchard/upsert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orchardBatchId: cleanBatchId,
          payload
        })
      });

      const data = await resp.json();
      if (!resp.ok || data.success === false) {
        throw new Error(data.error || `写入失败: ${resp.status}`);
      }

      await refreshAll();
      setInfo('A链写入成功: ' + cleanBatchId + (data.txId ? ' (tx: ' + data.txId + ')' : ''));
    } catch (err) {
      setError(err?.message || String(err));
    } finally {
      setUpsertLoading(false);
    }
  };

  const handleQuery = async () => {
    try {
      setQueryLoading(true);
      setQueryError('');
      const cleanBatchId = String(batchId || '').trim();
      if (!cleanBatchId) {
        throw new Error('orchardBatchId 不能为空');
      }

      const resp = await fetch('/api/demo/app/query/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orchardBatchId: cleanBatchId })
      });

      const data = await resp.json();
      if (!resp.ok || data.success === false) {
        throw new Error(data.error || `查询请求失败: ${resp.status}`);
      }

      setSelectedSessionId(data.queryId || '');
      await refreshAll();
    } catch (err) {
      setQueryError(err?.message || String(err));
    } finally {
      setQueryLoading(false);
    }
  };

  return (
    <main className="page">
      <header className="hero">
        <h1>跨链查询演示</h1>
        <p>FISCO 侧用户按批次号查询 Fabric 果园数据，并展示可审计的跨链查询会话状态。</p>
        <div className="url-row">
          <span>Windows 地址: http://localhost:15173/app-query</span>
          <span>备用地址: {fallbackUrl}/app-query</span>
          <span>自动刷新: 5 秒</span>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {info ? <p className="muted">{info}</p> : null}
      </header>

      <section className="grid two">
        <article className="card">
          <h2>A链数据池（Fabric）</h2>
          <label>
            果园批次号（orchardBatchId）
            <input value={batchId} onChange={(event) => setBatchId(event.target.value)} />
          </label>

          <label>
            从外部 JSON 选择记录
            <input type="file" accept=".json,application/json" onChange={handleImportJsonFile} />
          </label>
          {importedFileName ? <p className="muted">已导入文件: {importedFileName}</p> : null}
          {importedRecords.length ? (
            <label>
              已导入记录
              <select value={selectedImportIndex} onChange={(event) => handleUseImportedRecord(event.target.value)}>
                {importedRecords.map((record, index) => (
                  <option key={`${record.orchardBatchId}_${index}`} value={index}>
                    {record.orchardBatchId} / {record.eventType}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {importError ? <p className="error">{importError}</p> : null}

          <div className="button-row">
            <button type="button" onClick={handleUpsert} disabled={upsertLoading || loading}>
              写入 A 链记录
            </button>
            <button type="button" onClick={() => refreshAll().catch(() => {})} disabled={loading}>
              刷新
            </button>
          </div>

          <h3>最近写入记录（A链可见）</h3>
          <div className="query-table">
            <div className="query-row query-head">
              <span>批次号</span>
              <span>事件类型</span>
              <span>事件时间</span>
            </div>
            {orchardItems.length === 0 ? (
              <div className="query-row">
                <span className="muted">暂无记录</span>
              </div>
            ) : null}
            {orchardItems.map((item) => (
              <button
                type="button"
                key={item.orchardBatchId}
                className="query-row query-click"
                onClick={() => setBatchId(item.orchardBatchId)}
              >
                <span>{item.orchardBatchId}</span>
                <span>{item.payload?.eventType || '-'}</span>
                <span>{item.payload?.eventAt || '-'}</span>
              </button>
            ))}
          </div>
        </article>

        <article className="card">
          <h2>B链查询面板（FISCO 用户）</h2>
          <p className="muted">输入批次号后发起跨链查询。右侧只展示 B 链用户可见的查询会话结果。</p>
          <label>
            查询批次号
            <input value={batchId} onChange={(event) => setBatchId(event.target.value)} />
          </label>
          <div className="button-row">
            <button type="button" onClick={handleQuery} disabled={queryLoading || loading}>
              从 FISCO 发起查询 -&gt; Fabric
            </button>
          </div>
          {queryError ? <p className="error">{queryError}</p> : null}

          <h3>最近查询结果（B链可见）</h3>
          <div className="runtime-list">
            <div><strong>会话 ID:</strong> {selectedSession?.queryId || '-'}</div>
            <div><strong>状态:</strong> {formatQueryStatus(selectedSession?.status)}</div>
            <div>
              <strong>查询结果:</strong>{' '}
              {selectedSession?.resultFound === null ? '-' : selectedSession?.resultFound ? '已找到' : '未找到'}
            </div>
            <div><strong>校验/判定:</strong> {selectedSessionBadgeText}</div>
            <div><strong>执行进度:</strong> <QueryStatusBar session={selectedSession} /></div>
            <div><strong>阶段耗时:</strong> {buildStageElapsedSummary(selectedSession)}</div>
            <div><strong>请求交易:</strong> {shorten(selectedSession?.requestTxHash)}</div>
            <div><strong>响应交易:</strong> {shorten(selectedSession?.responseTargetTxHash)}</div>
          </div>

          {selectedSession?.resultPayload ? (
            <pre className="result">{JSON.stringify(selectedSession.resultPayload, null, 2)}</pre>
          ) : (
            <p className="muted">当前会话尚无返回载荷</p>
          )}
        </article>
      </section>

      <section className="card">
        <h2>查询会话列表</h2>
        <div className="proof-list">
          {sessions.length === 0 ? <p className="muted">暂无查询会话</p> : null}
          {sessions.map((item) => {
            const badgeTone = getSessionBadgeTone(item);
            const badgeText = getSessionBadgeText(item);
            return (
              <details
                key={item.queryId}
                className={`proof-card proof-${badgeTone}`}
                onToggle={(event) => {
                  if (event.currentTarget.open) {
                    setSelectedSessionId(item.queryId);
                  }
                }}
              >
                <summary className="proof-summary">
                  <span>{item.queryId}</span>
                  <span className={`proof-status status-${badgeTone}`}>{badgeText}</span>
                  <span>{item.updatedAt || item.requestTs}</span>
                </summary>
                <div className="proof-columns">
                  <div className="proof-side">
                    <h4>请求侧（B 链）</h4>
                    <div>批次号: {item.orchardBatchId}</div>
                    <div>会话状态: {formatQueryStatus(item.status)}</div>
                    <div>请求交易: {shorten(item.requestTxHash)}</div>
                    <div>响应请求交易: {shorten(item.responseRequestTxHash)}</div>
                  </div>
                  <div className="proof-middle">
                    <QueryStatusBar session={item} compact />
                    <div>阶段耗时: {buildStageElapsedSummary(item)}</div>
                    <div>错误码: {item.errorCode || '-'}</div>
                    <div>回执: {item.receiptStatus || '-'}</div>
                    <div>是否命中: {item.resultFound === null ? '-' : String(item.resultFound)}</div>
                  </div>
                  <div className="proof-side">
                    <h4>响应侧（A -&gt; B）</h4>
                    <div>目标交易: {shorten(item.responseTargetTxHash)}</div>
                    <div>请求哈希: {shorten(item.requestPayloadHash)}</div>
                    <div>响应哈希: {shorten(item.responsePayloadHash)}</div>
                    <div>完成时间: {item.settleTs || '-'}</div>
                  </div>
                </div>
                {item.resultPayload ? (
                  <pre className="result">{JSON.stringify(item.resultPayload, null, 2)}</pre>
                ) : null}
                {Array.isArray(item.steps) && item.steps.length ? (
                  <div className="timeline">
                    {item.steps.map((step, index) => (
                      <div key={`${item.queryId}_${index}`} className="timeline-item">
                        <div className="timeline-meta">
                          <span>{step.ts}</span>
                          <span>{step.step}</span>
                        </div>
                        <div className="muted">
                          累计: {formatElapsed(step?.details?.elapsedFromRequestMs)} / 本阶段: {formatElapsed(step?.details?.elapsedFromPreviousStepMs)}
                        </div>
                        <div>{JSON.stringify(step.details || {})}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
            );
          })}
        </div>
      </section>
    </main>
  );
}
