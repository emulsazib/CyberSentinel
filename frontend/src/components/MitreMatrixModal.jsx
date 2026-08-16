import React, { useState } from 'react';
import { X, Search, Grid, ExternalLink } from 'lucide-react';

export default function MitreMatrixModal({ isOpen, onClose, tactics = [], techniques = [], onSelectTechnique }) {
  const [searchTerm, setSearchTerm] = useState('');

  if (!isOpen) return null;

  const filteredTechniques = techniques.filter(t =>
    t.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    t.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (t.description && t.description.toLowerCase().includes(searchTerm.toLowerCase()))
  );

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '1020px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Grid size={18} style={{ color: 'var(--accent-cyber)' }} />
            <span>MITRE ATT&CK Enterprise Matrix Navigator</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: '12px 20px 0', borderBottom: '1px solid var(--border-subtle)' }}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', marginBottom: '12px' }}>
            <Search size={15} style={{ position: 'absolute', left: '12px', color: 'var(--text-muted)' }} />
            <input
              type="text"
              className="form-input"
              style={{ width: '100%', paddingLeft: '36px' }}
              placeholder="Search techniques by ID (e.g. T1059), name, or keyword..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="modal-body">
          <div className="matrix-grid">
            {tactics.map((tactic) => {
              const tacTechs = filteredTechniques.filter(t =>
                t.tactics && t.tactics.some(tac => tac.toLowerCase() === tactic.name.toLowerCase())
              );

              if (tacTechs.length === 0 && searchTerm) return null;

              return (
                <div key={tactic.id} className="tactic-column">
                  <div className="tactic-col-title">
                    {tactic.name}
                    <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', marginLeft: '4px' }}>
                      ({tacTechs.length})
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                    {tacTechs.map((tech) => (
                      <div
                        key={tech.id}
                        className="matrix-tech-item"
                        onClick={() => {
                          onSelectTechnique(tech.id, tech);
                          onClose();
                        }}
                      >
                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{tech.id}</span>
                        <span style={{ color: 'var(--text-secondary)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tech.name}
                        </span>
                      </div>
                    ))}
                    {tacTechs.length === 0 && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', padding: '6px' }}>
                        No matching techniques
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
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
