import React, { useState } from 'react';
import { X, Sparkles, Play, Search, ArrowRight } from 'lucide-react';

export default function SampleProbesModal({ isOpen, onClose, samples = [], onSelectSample }) {
  const [filterTactic, setFilterTactic] = useState('all');

  if (!isOpen) return null;

  const tactics = ['all', ...new Set(samples.map(s => s.tactic))];
  const filteredSamples = filterTactic === 'all'
    ? samples
    : samples.filter(s => s.tactic === filterTactic);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '780px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Sparkles size={18} style={{ color: 'var(--accent-amber)' }} />
            <span>CTI Benchmark Probes & Test Scenarios</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border-subtle)', display: 'flex', gap: '6px', overflowX: 'auto' }}>
          {tactics.map((tac) => (
            <button
              key={tac}
              className={`mode-btn ${filterTactic === tac ? 'active' : ''}`}
              onClick={() => setFilterTactic(tac)}
            >
              {tac === 'all' ? 'All Tactics' : tac}
            </button>
          ))}
        </div>

        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '10px' }}>
            {filteredSamples.map((sample) => (
              <div
                key={sample.id}
                className="sample-probe-card"
                style={{ padding: '12px 14px' }}
                onClick={() => {
                  onSelectSample(sample);
                  onClose();
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className="probe-tactic-tag">{sample.tactic}</span>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem' }}>{sample.title}</span>
                  </div>
                  <span className="probe-expected-tid">Expected: {sample.expectedTid}</span>
                </div>

                <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--text-secondary)', background: 'var(--bg-primary)', padding: '8px 10px', borderRadius: '4px', border: '1px solid var(--border-subtle)' }}>
                  {sample.instruction}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                  <span>{sample.description}</span>
                  <span style={{ color: 'var(--accent-cyber)', display: 'flex', alignItems: 'center', gap: '4px', fontWeight: 600 }}>
                    Evaluate Sample <ArrowRight size={12} />
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
