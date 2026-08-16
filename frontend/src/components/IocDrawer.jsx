import React, { useState } from 'react';
import { X, Activity, Copy, Check, Download, Filter } from 'lucide-react';

export default function IocDrawer({ isOpen, onClose, iocs }) {
  const [copied, setCopied] = useState(false);
  const [filterType, setFilterType] = useState('all');

  if (!isOpen) return null;

  const { ips = [], domains = [], hashes = [], registryKeys = [], files = [] } = iocs || {};

  const allItems = [
    ...ips.map(v => ({ type: 'IP', value: v })),
    ...domains.map(v => ({ type: 'Domain', value: v })),
    ...hashes.map(v => ({ type: 'Hash', value: v })),
    ...registryKeys.map(v => ({ type: 'Registry', value: v })),
    ...files.map(v => ({ type: 'Binary/Script', value: v }))
  ];

  const filteredItems = filterType === 'all'
    ? allItems
    : allItems.filter(item => item.type.toLowerCase() === filterType.toLowerCase());

  const handleCopyAll = () => {
    const text = filteredItems.map(i => `${i.type}: ${i.value}`).join('\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadCsv = () => {
    const header = 'Type,Value\n';
    const rows = filteredItems.map(i => `"${i.type}","${i.value.replace(/"/g, '""')}"`).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cybersentinel_iocs_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="slide-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Activity size={18} style={{ color: 'var(--accent-cyan)' }} />
            <span style={{ fontWeight: 700, fontSize: '1rem' }}>Extracted IOC Telemetry</span>
            <span style={{ fontSize: '0.75rem', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
              ({allItems.length})
            </span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          {['all', 'IP', 'Domain', 'Hash', 'Registry', 'Binary/Script'].map(t => (
            <button
              key={t}
              className={`mode-btn ${filterType.toLowerCase() === t.toLowerCase() ? 'active' : ''}`}
              style={{ fontSize: '0.72rem', padding: '3px 8px' }}
              onClick={() => setFilterType(t)}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {filteredItems.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px 0', fontSize: '0.85rem' }}>
              No Indicators of Compromise extracted yet in this session.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {filteredItems.map((item, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: 'var(--bg-card)',
                    border: '1px solid var(--border-subtle)',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.78rem'
                  }}
                >
                  <span style={{ color: 'var(--text-highlight)', wordBreak: 'break-all' }}>{item.value}</span>
                  <span className={`ioc-chip ${item.type.toLowerCase()}`} style={{ fontSize: '0.65rem', flexShrink: 0 }}>
                    {item.type}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
          <button className="btn btn-outline" onClick={handleCopyAll} disabled={filteredItems.length === 0}>
            {copied ? <Check size={14} style={{ color: 'var(--accent-cyber)' }} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy All'}</span>
          </button>
          <button className="btn btn-primary" onClick={handleDownloadCsv} disabled={filteredItems.length === 0}>
            <Download size={14} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>
    </div>
  );
}
