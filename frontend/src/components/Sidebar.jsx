import React from 'react';
import { Plus, Trash2, MessageSquare, Flame, CheckCircle, Terminal, HardDrive, BrainCircuit, LayoutDashboard } from 'lucide-react';

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  samples = [],
  onSelectSample,
  systemStatus,
  currentView = 'chat',
  onChangeView = () => {},
  reasoningStepCount = 0
}) {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onNewSession}>
          <Plus size={15} />
          <span>New Threat Analysis</span>
        </button>

        <div className="sidebar-nav-group">
          <button 
            className={`sidebar-nav-btn ${currentView === 'chat' ? 'active' : ''}`}
            onClick={() => onChangeView('chat')}
            title="Chat Session"
          >
            <MessageSquare size={15} style={{ flexShrink: 0 }} />
            <span className="sidebar-nav-label">Chat Session</span>
          </button>
          <button 
            className={`sidebar-nav-btn ${currentView === 'dashboard' ? 'active' : ''}`}
            onClick={() => onChangeView('dashboard')}
            title="Reasoning Step Dashboard"
          >
            <BrainCircuit size={15} style={{ flexShrink: 0 }} />
            <span className="sidebar-nav-label">Reasoning Steps</span>
            {reasoningStepCount > 0 && (
              <span className="sidebar-step-badge">{reasoningStepCount}</span>
            )}
          </button>
        </div>
      </div>



      <div className="sidebar-content">
        {/* Past Sessions */}
        <div>
          <div className="sidebar-section-title">Analysis Sessions ({sessions.length})</div>
          <div className="session-list">
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                onClick={() => onSelectSession(session.id)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <MessageSquare size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                  <span className="session-title">{session.title || 'Untitled Session'}</span>
                </div>
                {sessions.length > 1 && (
                  <button
                    className="session-delete-btn"
                    title="Delete session"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Benchmark Probes Library */}
        <div>
          <div className="sidebar-section-title" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Flame size={12} style={{ color: 'var(--accent-amber)' }} />
            <span>CTI Benchmark Probes</span>
          </div>
          <div className="sample-probe-list">
            {samples.map((sample) => (
              <div
                key={sample.id}
                className="sample-probe-card"
                onClick={() => onSelectSample(sample)}
                title={`Expected: ${sample.expectedTid} — Click to analyze snippet`}
              >
                <div className="probe-header">
                  <span className="probe-tactic-tag">{sample.tactic}</span>
                  <span className="probe-expected-tid">{sample.expectedTid}</span>
                </div>
                <div className="probe-title">{sample.title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* System Telemetry Footer */}
      <div className="sidebar-footer">
        <div className="system-stat-row">
          <span>Base Model:</span>
          <span style={{ color: 'var(--text-primary)' }}>Qwen2.5-1.5B</span>
        </div>
        <div className="system-stat-row">
          <span>LoRA Adapter:</span>
          <span style={{ color: 'var(--accent-cyber)' }}>GRPO CTI Policy</span>
        </div>
        <div className="system-stat-row">
          <span>Status:</span>
          <span style={{ color: 'var(--accent-cyber)', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <CheckCircle size={11} /> Ready
          </span>
        </div>
      </div>
    </aside>
  );
}
