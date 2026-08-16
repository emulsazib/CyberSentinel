import React from 'react';
import { X, Shield, AlertTriangle, CheckCircle2, Search, ExternalLink } from 'lucide-react';

export default function MitreDrawer({ isOpen, onClose, technique }) {
  if (!isOpen || !technique) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="slide-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span className="mitre-id-pill" style={{ fontSize: '0.9rem' }}>{technique.id}</span>
            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{technique.name}</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="drawer-body">
          {/* Tactics */}
          <div className="drawer-section">
            <div className="drawer-section-title">Tactics</div>
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
              {technique.tactics?.map((t, idx) => (
                <span key={idx} className="tactic-tag-badge">{t}</span>
              ))}
            </div>
          </div>

          {/* Description */}
          <div className="drawer-section">
            <div className="drawer-section-title">Description</div>
            <p style={{ fontSize: '0.85rem', color: '#cbd5e1', lineHeight: '1.6' }}>
              {technique.description || 'No detailed description available.'}
            </p>
          </div>

          {/* Detection Engineering */}
          {technique.detection && (
            <div className="drawer-section">
              <div className="drawer-section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Search size={14} style={{ color: 'var(--accent-cyan)' }} />
                <span>Detection Engineering Strategies</span>
              </div>
              <div style={{
                backgroundColor: 'var(--bg-input)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '6px',
                padding: '12px',
                fontSize: '0.8rem',
                color: '#94a3b8',
                lineHeight: '1.5'
              }}>
                {technique.detection}
              </div>
            </div>
          )}

          {/* Mitigations */}
          {technique.mitigations && technique.mitigations.length > 0 && (
            <div className="drawer-section">
              <div className="drawer-section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <CheckCircle2 size={14} style={{ color: 'var(--accent-cyber)' }} />
                <span>Defensive Mitigations</span>
              </div>
              <ul className="drawer-list">
                {technique.mitigations.map((mit, i) => (
                  <li key={i} className="drawer-list-item">
                    {mit}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* External ATT&CK link */}
          <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
            <a
              href={`https://attack.mitre.org/techniques/${technique.id.replace('.', '/')}/`}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline"
              style={{ width: '100%', textDecoration: 'none' }}
            >
              <ExternalLink size={14} />
              <span>View Official MITRE ATT&CK Page</span>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
