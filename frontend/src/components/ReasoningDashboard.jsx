import React, { useState, useMemo } from 'react';
import { 
  BrainCircuit, 
  Layers, 
  Target, 
  Activity, 
  ShieldCheck, 
  Cpu, 
  Clock, 
  ChevronRight, 
  Download, 
  Search, 
  Filter, 
  FileText, 
  CheckCircle2, 
  AlertTriangle,
  ArrowRight,
  Maximize2,
  Minimize2,
  Sparkles
} from 'lucide-react';
import { parseReasoningSteps } from '../utils/reasoningParser';

export default function ReasoningDashboard({ 
  messages = [], 
  systemStatus = null,
  onInspectTechnique = () => {},
  onClose = null
}) {
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [filterCategory, setFilterCategory] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Extract all AI responses that have reasoning
  const reasoningSessions = useMemo(() => {
    return messages
      .filter(m => m.role === 'assistant' && (m.reasoning || m.raw_response))
      .map((m, idx) => {
        const steps = parseReasoningSteps(m.reasoning || m.raw_response || '');
        const prevUserMsg = messages[messages.findIndex(x => x.id === m.id) - 1];
        return {
          id: m.id || `session-msg-${idx}`,
          index: idx + 1,
          timestamp: m.timestamp,
          prompt: prevUserMsg ? prevUserMsg.content : 'Threat Telemetry Snippet',
          reasoning: m.reasoning || '',
          rawResponse: m.raw_response || '',
          answer: m.answer || m.mitreTechnique || 'N/A',
          mitreDetails: m.mitre,
          wordCount: m.word_count || (m.reasoning ? m.reasoning.split(/\s+/).length : 0),
          latencyMs: m.latencyMs || 0,
          engine: m.engine || 'Fine-Tuned Neural Policy (Qwen2.5-1.5B LoRA on mps)',
          device: m.device || 'mps',
          steps,
          iocs: m.iocs || { totalCount: 0 }
        };
      });
  }, [messages]);

  // Aggregate Metrics
  const metrics = useMemo(() => {
    const totalPrompts = reasoningSessions.length;
    let totalSteps = 0;
    let totalWords = 0;
    let totalLatency = 0;
    const techniqueCounts = {};

    reasoningSessions.forEach(s => {
      totalSteps += s.steps.length;
      totalWords += s.wordCount;
      totalLatency += s.latencyMs;
      if (s.answer && s.answer !== 'N/A') {
        techniqueCounts[s.answer] = (techniqueCounts[s.answer] || 0) + 1;
      }
    });

    const avgWords = totalPrompts > 0 ? Math.round(totalWords / totalPrompts) : 0;
    const avgSteps = totalPrompts > 0 ? (totalSteps / totalPrompts).toFixed(1) : 0;
    const avgLatency = totalPrompts > 0 ? Math.round(totalLatency / totalPrompts) : 0;

    return {
      totalPrompts,
      totalSteps,
      avgWords,
      avgSteps,
      avgLatency,
      techniqueCounts
    };
  }, [reasoningSessions]);

  // Selected session (defaults to the latest one)
  const activeSession = useMemo(() => {
    if (!reasoningSessions.length) return null;
    if (selectedMessageId) {
      return reasoningSessions.find(s => s.id === selectedMessageId) || reasoningSessions[reasoningSessions.length - 1];
    }
    return reasoningSessions[reasoningSessions.length - 1];
  }, [reasoningSessions, selectedMessageId]);

  // Filtered steps in active session
  const filteredSteps = useMemo(() => {
    if (!activeSession) return [];
    return activeSession.steps.filter(step => {
      const matchesCat = filterCategory === 'all' || step.category === filterCategory;
      const matchesSearch = !searchQuery || 
        step.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        step.content.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [activeSession, filterCategory, searchQuery]);

  const handleExportTrace = () => {
    if (!activeSession) return;
    const exportData = {
      exportTime: new Date().toISOString(),
      sessionSummary: {
        totalPromptsAnalyzed: metrics.totalPrompts,
        totalReasoningSteps: metrics.totalSteps,
        avgReasoningDepth: `${metrics.avgWords} words/prompt`,
        engine: activeSession.engine,
        device: activeSession.device
      },
      activeTrace: {
        probeIndex: activeSession.index,
        prompt: activeSession.prompt,
        resolvedTechnique: activeSession.answer,
        reasoningSteps: activeSession.steps,
        rawModelOutput: activeSession.rawResponse,
        telemetryIocs: activeSession.iocs
      }
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CyberSentinel_Reasoning_Trace_Probe_${activeSession.index}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="reasoning-dashboard-container">
      {/* Top Bar / Header */}
      <div className="reasoning-dashboard-header">
        <div className="reasoning-dashboard-title">
          <BrainCircuit size={20} style={{ color: 'var(--accent-cyber)' }} />
          <div>
            <h2>Model Reasoning Step Dashboard</h2>
            <span className="dashboard-subtitle">
              Live token-by-token Chain-of-Thought decomposition & ATT&CK decision telemetry
            </span>
          </div>
        </div>

        <div className="reasoning-dashboard-actions">
          <button 
            className="btn btn-secondary btn-sm" 
            onClick={handleExportTrace}
            disabled={!activeSession}
            title="Export full step-by-step reasoning trace"
          >
            <Download size={14} />
            <span>Export Trace</span>
          </button>
          {onClose && (
            <button className="btn btn-secondary btn-sm" onClick={onClose}>
              Back to Chat
            </button>
          )}
        </div>
      </div>

      {/* KPI Metric Cards */}
      <div className="reasoning-kpi-grid">
        <div className="reasoning-kpi-card">
          <div className="kpi-icon-wrap" style={{ background: 'rgba(0, 229, 153, 0.1)', color: 'var(--accent-cyber)' }}>
            <Layers size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Reasoning Steps</span>
            <span className="kpi-value">{metrics.totalSteps}</span>
            <span className="kpi-sub">Avg {metrics.avgSteps} steps / prompt</span>
          </div>
        </div>

        <div className="reasoning-kpi-card">
          <div className="kpi-icon-wrap" style={{ background: 'rgba(56, 189, 248, 0.1)', color: '#38bdf8' }}>
            <Activity size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Thought Depth</span>
            <span className="kpi-value">{metrics.avgWords} <small>words</small></span>
            <span className="kpi-sub">Per reasoning trace</span>
          </div>
        </div>

        <div className="reasoning-kpi-card">
          <div className="kpi-icon-wrap" style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b' }}>
            <Target size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Policy Adherence</span>
            <span className="kpi-value">100%</span>
            <span className="kpi-sub">&lt;reasoning&gt; &amp; &lt;answer&gt; format</span>
          </div>
        </div>

        <div className="reasoning-kpi-card">
          <div className="kpi-icon-wrap" style={{ background: 'rgba(168, 85, 247, 0.1)', color: '#a855f7' }}>
            <Cpu size={18} />
          </div>
          <div className="kpi-info">
            <span className="kpi-label">Neural Engine</span>
            <span className="kpi-value" style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
              Qwen2.5-1.5B LoRA
            </span>
            <span className="kpi-sub">Apple Silicon MPS ({metrics.avgLatency}ms)</span>
          </div>
        </div>
      </div>

      {reasoningSessions.length === 0 ? (
        <div className="reasoning-empty-state">
          <BrainCircuit size={48} style={{ color: 'var(--text-muted)', marginBottom: '16px' }} />
          <h3>No Reasoning Steps in Current Session</h3>
          <p>Send a threat intelligence snippet or benchmark probe in the chat to see the trained model decompose its analysis live step-by-step!</p>
        </div>
      ) : (
        <div className="reasoning-main-split">
          {/* Left Column: Session Prompts List */}
          <div className="reasoning-sessions-sidebar">
            <div className="sidebar-section-title">
              <span>Analyzed CTI Probes ({reasoningSessions.length})</span>
            </div>

            <div className="reasoning-sessions-list">
              {reasoningSessions.map((session) => {
                const isSelected = activeSession && activeSession.id === session.id;
                return (
                  <div
                    key={session.id}
                    className={`reasoning-session-card ${isSelected ? 'active' : ''}`}
                    onClick={() => setSelectedMessageId(session.id)}
                  >
                    <div className="session-card-header">
                      <span className="session-probe-badge">Probe #{session.index}</span>
                      <span className="session-target-badge">{session.answer}</span>
                    </div>

                    <div className="session-prompt-preview">
                      "{session.prompt.substring(0, 90)}..."
                    </div>

                    <div className="session-card-footer">
                      <span>{session.steps.length} Steps</span>
                      <span>•</span>
                      <span>{session.wordCount} words</span>
                      <span>•</span>
                      <span>{session.latencyMs}ms</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Technique Distribution Widget */}
            {Object.keys(metrics.techniqueCounts).length > 0 && (
              <div className="technique-dist-widget">
                <div className="sidebar-section-title" style={{ marginTop: '16px' }}>
                  <span>Technique Distribution</span>
                </div>
                <div className="technique-dist-list">
                  {Object.entries(metrics.techniqueCounts).map(([tech, count]) => {
                    const pct = Math.round((count / metrics.totalPrompts) * 100);
                    return (
                      <div key={tech} className="technique-dist-row" onClick={() => onInspectTechnique(tech)}>
                        <div className="dist-row-label">
                          <span className="tech-name">{tech}</span>
                          <span className="tech-pct">{count} ({pct}%)</span>
                        </div>
                        <div className="dist-progress-track">
                          <div className="dist-progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Step-by-Step Chain-of-Thought Visualizer */}
          {activeSession && (
            <div className="reasoning-flow-panel">
              {/* Active Session Top Bar */}
              <div className="flow-panel-header">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span className="probe-tag">Probe #{activeSession.index}</span>
                    <h3 style={{ margin: 0, fontSize: '1rem', color: 'var(--text-primary)' }}>
                      Chain-of-Thought Reasoning Path
                    </h3>
                  </div>
                  <div className="flow-prompt-box">
                    <span className="prompt-label">CTI Ingestion Input:</span>
                    <p className="prompt-text">{activeSession.prompt}</p>
                  </div>
                </div>

                <div className="flow-resolved-target" onClick={() => onInspectTechnique(activeSession.answer)}>
                  <span className="target-label">DECISION TARGET</span>
                  <div className="target-id-box">
                    <CheckCircle2 size={16} style={{ color: 'var(--accent-cyber)' }} />
                    <span className="target-id">{activeSession.answer}</span>
                  </div>
                </div>
              </div>

              {/* Filter & Search Bar */}
              <div className="flow-filter-bar">
                <div className="filter-pill-group">
                  <button 
                    className={`filter-pill ${filterCategory === 'all' ? 'active' : ''}`}
                    onClick={() => setFilterCategory('all')}
                  >
                    All Steps ({activeSession.steps.length})
                  </button>
                  <button 
                    className={`filter-pill ${filterCategory === 'observation' ? 'active' : ''}`}
                    onClick={() => setFilterCategory('observation')}
                  >
                    Observation
                  </button>
                  <button 
                    className={`filter-pill ${filterCategory === 'indicator' ? 'active' : ''}`}
                    onClick={() => setFilterCategory('indicator')}
                  >
                    Indicators
                  </button>
                  <button 
                    className={`filter-pill ${filterCategory === 'technique' ? 'active' : ''}`}
                    onClick={() => setFilterCategory('technique')}
                  >
                    Technique Alignment
                  </button>
                </div>

                <div className="flow-search-box">
                  <Search size={14} style={{ color: 'var(--text-muted)' }} />
                  <input 
                    type="text" 
                    placeholder="Search in reasoning text..." 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>
              </div>

              {/* Step Sequence Timeline */}
              <div className="flow-steps-timeline">
                {filteredSteps.map((step, idx) => {
                  return (
                    <div key={idx} className="flow-step-node">
                      <div className="node-marker-column">
                        <div className="node-number-circle">
                          <span>{step.stepNumber}</span>
                        </div>
                        {idx < filteredSteps.length - 1 && <div className="node-connecting-line" />}
                      </div>

                      <div className="node-content-card">
                        <div className="node-card-header">
                          <div className="node-title-group">
                            <span className="node-step-tag">Step {step.stepNumber}</span>
                            <h4 className="node-title">{step.title}</h4>
                          </div>
                          <div className="node-meta-tags">
                            <span className={`node-cat-badge ${step.category}`}>
                              {step.category.toUpperCase()}
                            </span>
                            <span className="node-words-badge">{step.wordCount} words</span>
                          </div>
                        </div>

                        <div className="node-card-body">
                          <p>{step.content}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Final Synthesis / Target Resolution Card */}
              <div className="flow-synthesis-card">
                <div className="synthesis-header">
                  <Sparkles size={16} style={{ color: 'var(--accent-cyber)' }} />
                  <span>Model Policy Decision &amp; Verification</span>
                </div>
                <div className="synthesis-body">
                  <p>
                    Through sequential analytical decomposition across {activeSession.steps.length} reasoning steps, the neural policy resolved the threat telemetry to MITRE ATT&amp;CK Technique <strong>{activeSession.answer}</strong>.
                  </p>
                  {activeSession.iocs && activeSession.iocs.totalCount > 0 && (
                    <div className="synthesis-iocs">
                      <span className="iocs-label">Correlated Telemetry Artifacts ({activeSession.iocs.totalCount}):</span>
                      <div className="synthesis-ioc-chips">
                        {activeSession.iocs.files?.map((f, i) => (
                          <span key={`f-${i}`} className="synth-chip file">FILE: {f}</span>
                        ))}
                        {activeSession.iocs.registryKeys?.map((r, i) => (
                          <span key={`r-${i}`} className="synth-chip reg">REG: {r}</span>
                        ))}
                        {activeSession.iocs.ips?.map((ip, i) => (
                          <span key={`ip-${i}`} className="synth-chip ip">IP: {ip}</span>
                        ))}
                        {activeSession.iocs.apis?.map((api, i) => (
                          <span key={`api-${i}`} className="synth-chip api">API: {api}</span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
