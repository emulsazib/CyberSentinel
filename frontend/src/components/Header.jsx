import React from 'react';
import { Shield, Grid, Terminal, Settings, Download, Plus, Cpu, Activity } from 'lucide-react';

export default function Header({
  systemStatus,
  currentView = 'chat',
  onChangeView = () => {},
  onNewSession,
  onOpenMatrix,
  onOpenIocs,
  onOpenSettings,
  onExportSession,
  iocCount = 0,
  reasoningStepCount = 0
}) {
  const isOnline = systemStatus?.status === 'online';
  const modelLoaded = systemStatus?.model?.model_loaded;
  const device = systemStatus?.model?.device || 'cpu';

  return (
    <header className="app-header">
      <div className="brand-section">
        <div className="brand-logo">
          <Shield size={24} />
        </div>
        <div className="brand-title">
          CyberSentinel
          <span className="brand-badge">CTI ANALYST</span>
        </div>
      </div>

      <div className="header-center">
        {/* View Switcher: Chat vs Reasoning Dashboard */}
        <div className="view-mode-pill-group">
          <button 
            className={`view-mode-btn ${currentView === 'chat' ? 'active' : ''}`}
            onClick={() => onChangeView('chat')}
            title="Interactive CTI Chat Session"
          >
            <span>Chat Session</span>
          </button>
          <button 
            className={`view-mode-btn ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => onChangeView('dashboard')}
            title="Step-by-Step Model Reasoning Dashboard"
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              Reasoning Dashboard
              {reasoningStepCount > 0 && (
                <span className="header-step-badge">{reasoningStepCount}</span>
              )}
            </span>
          </button>
        </div>

        <div className="model-status-pill" title={`Device: ${device.toUpperCase()} | Base: Qwen2.5-1.5B | LoRA Adapters Active`}>
          <div className={`status-dot ${isOnline ? (modelLoaded ? 'online' : 'active') : 'warning'}`} />
          <span>{modelLoaded ? 'Qwen2.5-1.5B LoRA' : 'CTI Policy Engine'}</span>
          <span style={{ color: 'var(--text-muted)' }}>•</span>
          <span style={{ color: 'var(--accent-cyan)', display: 'flex', alignItems: 'center', gap: '3px' }}>
            <Cpu size={12} /> {device.toUpperCase()}
          </span>
        </div>
      </div>

      <div className="header-actions">
        <button
          className="btn btn-outline"
          onClick={onOpenMatrix}
          title="Browse MITRE ATT&CK Matrix"
        >
          <Grid size={14} />
          <span>ATT&CK Matrix</span>
        </button>

        <button
          className="btn btn-outline"
          onClick={onOpenIocs}
          title="View Extracted Indicators of Compromise"
        >
          <Activity size={14} />
          <span>IOCs {iocCount > 0 && `(${iocCount})`}</span>
        </button>


        <button
          className="btn btn-ghost btn-icon"
          onClick={onExportSession}
          title="Export Conversation Report"
        >
          <Download size={16} />
        </button>

        <button
          className="btn btn-ghost btn-icon"
          onClick={onOpenSettings}
          title="Model & Inference Settings"
        >
          <Settings size={16} />
        </button>

        <button
          className="btn btn-primary"
          onClick={onNewSession}
          title="Start Fresh Investigation"
        >
          <Plus size={15} />
          <span>New Session</span>
        </button>
      </div>
    </header>
  );
}
