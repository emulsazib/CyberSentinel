import React from 'react';
import { ShieldAlert, ExternalLink, ShieldCheck } from 'lucide-react';

export default function MitreCard({ answer, mitreDetails, onInspectTechnique }) {
  if (!answer) return null;

  const techniqueName = mitreDetails?.name || 'MITRE ATT&CK Technique';
  const tactics = mitreDetails?.tactics || ['Execution'];
  const description = mitreDetails?.description;

  return (
    <div className="mitre-result-card">
      <div className="mitre-top-row">
        <div className="technique-identity">
          <span className="mitre-id-pill">{answer}</span>
          <span className="technique-name">{techniqueName}</span>
        </div>
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          {tactics.map((tactic, idx) => (
            <span key={idx} className="tactic-tag-badge">{tactic}</span>
          ))}
        </div>
      </div>

      {description && (
        <div className="mitre-description">
          {description}
        </div>
      )}

      <div className="mitre-card-actions">
        <button
          className="btn btn-outline"
          style={{ fontSize: '0.72rem', padding: '3px 8px' }}
          onClick={() => onInspectTechnique(answer, mitreDetails)}
        >
          <ExternalLink size={12} />
          <span>Inspect Mitigations & Detections</span>
        </button>
      </div>
    </div>
  );
}
