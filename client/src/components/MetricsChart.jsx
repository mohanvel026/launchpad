import { useEffect, useState, useRef } from 'react';
import { io } from 'socket.io-client';
import api from '../lib/api';

// Mini sparkline bar
function Bar({ value, max, color }) {
  const pct = Math.min((value / max) * 100, 100);
  return (
    <div style={{ background: '#1e293b', borderRadius: '4px', height: '8px', width: '100%', overflow: 'hidden' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: '4px', transition: 'width 0.3s' }} />
    </div>
  );
}

// Tiny sparkline graph (last 20 points)
function Sparkline({ data, color, height = 40 }) {
  if (!data || data.length < 2) return null;
  const max    = Math.max(...data, 1);
  const width  = 200;
  const points = data.slice(-20).map((v, i, arr) => {
    const x = (i / (arr.length - 1)) * width;
    const y = height - (v / max) * height;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function MetricsChart({ projectId }) {
  const [live,    setLive]    = useState(null);
  const [history, setHistory] = useState([]);
  const socketRef = useRef(null);

  // Load history on mount
  useEffect(() => {
    api.get(`/metrics/${projectId}/history`)
      .then((r) => setHistory(r.data.history || []))
      .catch(() => {});
  }, [projectId]);

  // Subscribe to live metrics via Socket.io
  useEffect(() => {
    const socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000');
    socket.emit('join:metrics', projectId);

    socket.on('metrics', (stats) => {
      setLive(stats);
      setHistory((prev) => [...prev.slice(-59), stats]);
    });

    socketRef.current = socket;
    return () => {
      socket.emit('leave:metrics', projectId);
      socket.disconnect();
    };
  }, [projectId]);

  const stats   = live || history[history.length - 1];
  const cpuHist = history.map((h) => h.cpu    || 0);
  const memHist = history.map((h) => h.memPct || 0);

  const card = {
    border: '1px solid #1e293b', borderRadius: '12px',
    padding: '1rem 1.2rem', background: '#0f172a',
  };

  if (!stats) {
    return (
      <div style={{ ...card, color: '#475569', fontSize: '13px' }}>
        No metrics yet — deploy an app to see live CPU and memory stats.
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>

      {/* CPU card */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>CPU</span>
          <span style={{ fontSize: '20px', fontWeight: '700', color: stats.cpu > 80 ? '#f87171' : '#4ade80' }}>
            {stats.cpu?.toFixed(1)}%
          </span>
        </div>
        <Bar value={stats.cpu} max={100} color={stats.cpu > 80 ? '#f87171' : '#4ade80'} />
        <div style={{ marginTop: '10px' }}>
          <Sparkline data={cpuHist} color="#4ade80" />
        </div>
        <div style={{ fontSize: '11px', color: '#475569', marginTop: '6px' }}>Last 10 minutes</div>
      </div>

      {/* Memory card */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', fontWeight: '500' }}>Memory</span>
          <span style={{ fontSize: '20px', fontWeight: '700', color: stats.memPct > 80 ? '#f87171' : '#60a5fa' }}>
            {stats.memMB} MB
          </span>
        </div>
        <Bar value={stats.memPct} max={100} color={stats.memPct > 80 ? '#f87171' : '#60a5fa'} />
        <div style={{ marginTop: '10px' }}>
          <Sparkline data={memHist} color="#60a5fa" />
        </div>
        <div style={{ fontSize: '11px', color: '#475569', marginTop: '6px' }}>
          {stats.memMB} / {stats.memLimit} MB · {stats.memPct}% used
        </div>
      </div>

      {/* Network card */}
      <div style={{ ...card, gridColumn: '1 / -1' }}>
        <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '500', marginBottom: '10px' }}>Network I/O</div>
        <div style={{ display: 'flex', gap: '2rem' }}>
          <div>
            <div style={{ fontSize: '11px', color: '#475569' }}>↓ Received</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#a78bfa' }}>{stats.rxMB || 0} MB</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#475569' }}>↑ Sent</div>
            <div style={{ fontSize: '16px', fontWeight: '600', color: '#fb923c' }}>{stats.txMB || 0} MB</div>
          </div>
          <div>
            <div style={{ fontSize: '11px', color: '#475569' }}>Status</div>
            <div style={{ fontSize: '14px', fontWeight: '600', color: stats.status === 'running' ? '#4ade80' : '#f87171' }}>
              ● {stats.status}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}