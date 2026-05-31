import { useEffect, useMemo, useRef, useState } from 'react';

function formatStatusFlag(value) {
  return value ? '已连接' : '未连接';
}

function formatDirectionLabel(direction) {
  if (direction === 'FABRIC_TO_FISCO') return 'Fabric -> FISCO';
  if (direction === 'FISCO_TO_FABRIC') return 'FISCO -> Fabric';
  return direction || '未知方向';
}

function formatStreamState(state) {
  if (state === 'connected') return '已连接';
  if (state === 'reconnecting') return '重连中';
  return '连接中';
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

export default function ExplorerPage() {
  const [status, setStatus] = useState(null);
  const [overview, setOverview] = useState({ chains: [], recentRelayMarkers: [] });
  const [fabricBlocks, setFabricBlocks] = useState([]);
  const [fiscoBlocks, setFiscoBlocks] = useState([]);
  const [events, setEvents] = useState([]);
  const [blockLimit, setBlockLimit] = useState(20);
  const [error, setError] = useState('');
  const [overviewError, setOverviewError] = useState('');
  const [blockErrors, setBlockErrors] = useState({ FABRIC_NET_01: '', FISCO_NET_01: '' });
  const [streamState, setStreamState] = useState('connecting');
  const [activeDirection, setActiveDirection] = useState('');
  const highlightTimerRef = useRef(null);

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

  const refreshExplorerOverview = async () => {
    const resp = await fetch('/api/demo/explorer/overview');
    if (!resp.ok) {
      throw new Error(`explorer overview request failed: ${resp.status}`);
    }
    const data = await resp.json();
    setOverview({
      chains: Array.isArray(data.chains) ? data.chains : [],
      recentRelayMarkers: Array.isArray(data.recentRelayMarkers) ? data.recentRelayMarkers : []
    });
  };

  const fetchChainBlocks = async (chainId, limit) => {
    const query = new URLSearchParams({ chainId, limit: String(limit) });
    const resp = await fetch(`/api/demo/explorer/blocks?${query.toString()}`);
    if (!resp.ok) {
      let detail = '';
      try {
        const data = await resp.json();
        detail = data.error ? `: ${data.error}` : '';
      } catch (_error) {
        // Ignore non-JSON error body.
      }
      throw new Error(`blocks request failed (${chainId}) ${resp.status}${detail}`);
    }
    const data = await resp.json();
    return Array.isArray(data.items) ? data.items : [];
  };

  const refreshExplorerBlocks = async (limit) => {
    const [fabricResult, fiscoResult] = await Promise.allSettled([
      fetchChainBlocks('FABRIC_NET_01', limit),
      fetchChainBlocks('FISCO_NET_01', limit)
    ]);

    setBlockErrors({
      FABRIC_NET_01: fabricResult.status === 'rejected' ? fabricResult.reason.message : '',
      FISCO_NET_01: fiscoResult.status === 'rejected' ? fiscoResult.reason.message : ''
    });

    if (fabricResult.status === 'fulfilled') {
      setFabricBlocks(fabricResult.value);
    }
    if (fiscoResult.status === 'fulfilled') {
      setFiscoBlocks(fiscoResult.value);
    }
  };

  const pulseDirection = (direction) => {
    if (direction !== 'FABRIC_TO_FISCO' && direction !== 'FISCO_TO_FABRIC') {
      return;
    }
    setActiveDirection(direction);
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(() => {
      setActiveDirection('');
      highlightTimerRef.current = null;
    }, 1200);
  };

  useEffect(() => {
    let timer = null;
    let mounted = true;

    const tick = async () => {
      try {
        await Promise.all([refreshStatus(), refreshEvents(), refreshExplorerOverview(), refreshExplorerBlocks(blockLimit)]);
        if (!mounted) return;
        setError('');
        setOverviewError('');
      } catch (err) {
        if (!mounted) return;
        const message = err?.message || String(err);
        if (message.includes('explorer overview')) {
          setOverviewError(message);
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
  }, [blockLimit]);

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
        if (item?.direction) {
          pulseDirection(item.direction);
        }
      } catch (_error) {
        // Ignore malformed event payload.
      }
    };
    es.onerror = () => {
      setStreamState('reconnecting');
    };

    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
        highlightTimerRef.current = null;
      }
      es.close();
    };
  }, []);

  const chains = status?.relayer?.chains || [];
  const overviewChains = overview?.chains || [];
  const statusFabric = chains.find((item) => item.chainId === 'FABRIC_NET_01');
  const statusFisco = chains.find((item) => item.chainId === 'FISCO_NET_01');
  const overviewFabric = overviewChains.find((item) => item.chainId === 'FABRIC_NET_01');
  const overviewFisco = overviewChains.find((item) => item.chainId === 'FISCO_NET_01');

  const fabric = {
    connected: overviewFabric?.connected ?? statusFabric?.isConnected ?? false,
    latestBlock: overviewFabric?.latestBlock ?? statusFabric?.latestBlock ?? null,
    latestObservedBlock: overviewFabric?.latestObservedBlock ?? null
  };
  const fisco = {
    connected: overviewFisco?.connected ?? statusFisco?.isConnected ?? false,
    latestBlock: overviewFisco?.latestBlock ?? statusFisco?.latestBlock ?? null,
    latestObservedBlock: overviewFisco?.latestObservedBlock ?? null
  };

  const markerTimeline = [...(overview?.recentRelayMarkers || [])].slice(-8).reverse();
  const timeline = [...events].reverse();

  return (
    <main className="page">
      <header className="hero">
        <h1>区块链浏览器（Lite）</h1>
        <p>查看链状态、最近区块、跨链标记与时间线</p>
        <div className="url-row">
          <span>Windows 地址: http://localhost:15173/explorer</span>
          <span>备用地址: {fallbackUrl}/explorer</span>
          <span>实时通道: {formatStreamState(streamState)}</span>
        </div>
        {error ? <p className="error">{error}</p> : null}
      </header>

      <section className="grid two">
        <article className="card">
          <h2>链状态</h2>
          <div className="status-row">
            <div>
              <h3>Fabric</h3>
              <p>{formatStatusFlag(fabric.connected)}</p>
              <small>最新区块: {fabric.latestBlock ?? '-'}</small>
              <small>观察到区块: {fabric.latestObservedBlock ?? '-'}</small>
            </div>
            <div>
              <h3>FISCO</h3>
              <p>{formatStatusFlag(fisco.connected)}</p>
              <small>最新区块: {fisco.latestBlock ?? '-'}</small>
              <small>观察到区块: {fisco.latestObservedBlock ?? '-'}</small>
            </div>
          </div>
        </article>

        <article className="card">
          <h2>最近跨链标记</h2>
          <div className="marker-list">
            {markerTimeline.length === 0 ? <p className="muted">暂无跨链标记</p> : null}
            {markerTimeline.map((marker, index) => (
              <div key={`${marker.ts}-${index}`} className={`marker-item ${marker.state === 'FAILED' ? 'marker-failed' : ''}`}>
                <span>{marker.ts}</span>
                <span>{formatDirectionLabel(marker.direction)}</span>
                <span>源区块 #{marker.sourceBlockNumber ?? '-'}</span>
                <span>{marker.state}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card">
        <h2>双链示意与区块摘要</h2>
        {overviewError ? <p className="error">{overviewError}</p> : null}

        <div className="topology-wrap">
          <div className={`topology-node ${fabric.connected ? 'ok' : 'bad'}`}>
            <strong>Fabric</strong>
            <span>高度 #{fabric.latestBlock ?? '-'}</span>
          </div>
          <div className="topology-links">
            <div className={`topology-link ${activeDirection === 'FABRIC_TO_FISCO' ? 'active' : ''}`}>Fabric -&gt; FISCO</div>
            <div className={`topology-link ${activeDirection === 'FISCO_TO_FABRIC' ? 'active' : ''}`}>FISCO -&gt; Fabric</div>
          </div>
          <div className={`topology-node ${fisco.connected ? 'ok' : 'bad'}`}>
            <strong>FISCO</strong>
            <span>高度 #{fisco.latestBlock ?? '-'}</span>
          </div>
        </div>

        <div className="explorer-toolbar">
          <label>
            最近区块数量
            <select value={blockLimit} onChange={(e) => setBlockLimit(Number(e.target.value))}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>
        </div>

        <div className="grid two block-grid">
          <div className="block-panel">
            <div className="panel-head">
              <h3>Fabric 最近区块</h3>
              {blockErrors.FABRIC_NET_01 ? <span className="panel-error">{blockErrors.FABRIC_NET_01}</span> : null}
            </div>
            <div className="block-list">
              {fabricBlocks.length === 0 ? <p className="muted">暂无区块数据</p> : null}
              {fabricBlocks.map((block) => (
                <div key={`fabric-${block.blockNumber}`} className="block-item">
                  <div>#{block.blockNumber}</div>
                  <div>交易数: {block.txCount ?? '-'}</div>
                  <div>来源: {block.source || '-'}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="block-panel">
            <div className="panel-head">
              <h3>FISCO 最近区块</h3>
              {blockErrors.FISCO_NET_01 ? <span className="panel-error">{blockErrors.FISCO_NET_01}</span> : null}
            </div>
            <div className="block-list">
              {fiscoBlocks.length === 0 ? <p className="muted">暂无区块数据</p> : null}
              {fiscoBlocks.map((block) => (
                <div key={`fisco-${block.blockNumber}`} className="block-item">
                  <div>#{block.blockNumber}</div>
                  <div>交易数: {block.txCount ?? '-'}</div>
                  <div className="hash-cell">{block.blockHash || '-'}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <h2>跨链时间线</h2>
        <div className="timeline">
          {timeline.length === 0 ? <p className="muted">暂无事件</p> : null}
          {timeline.map((item) => (
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
