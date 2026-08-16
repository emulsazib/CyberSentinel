import React, { useState, useEffect, useMemo } from 'react';
import Header from './components/Header.jsx';
import Sidebar from './components/Sidebar.jsx';
import ChatArea from './components/ChatArea.jsx';
import ChatInput from './components/ChatInput.jsx';
import MitreMatrixModal from './components/MitreMatrixModal.jsx';
import MitreDrawer from './components/MitreDrawer.jsx';
import IocDrawer from './components/IocDrawer.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import SampleProbesModal from './components/SampleProbesModal.jsx';
import ReasoningDashboard from './components/ReasoningDashboard.jsx';
import { parseReasoningSteps } from './utils/reasoningParser.js';


import {
  fetchSystemStatus,
  fetchSamples,
  fetchTactics,
  fetchTechniques,
  fetchTechniqueDetails,
  sendChatMessage
} from './services/api.js';

const STORAGE_KEY = 'cybersentinel_sessions_v1';

const DEFAULT_SETTINGS = {
  temperature: 0.1,
  max_new_tokens: 256,
  base_model: 'Qwen/Qwen2.5-1.5B-Instruct',
  adapter_path: './grpo_cti_tokenizer_model'
};

export default function App() {
  // Session State
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return [
      {
        id: `session-${Date.now()}`,
        title: 'Initial Investigation',
        createdAt: new Date().toISOString(),
        messages: []
      }
    ];
  });

  const [activeSessionId, setActiveSessionId] = useState(() => sessions[0]?.id);

  // System & Model Telemetry
  const [systemStatus, setSystemStatus] = useState(null);
  const [samples, setSamples] = useState([]);
  const [tactics, setTactics] = useState([]);
  const [techniques, setTechniques] = useState([]);

  // UI States & View Modes
  const [currentView, setCurrentView] = useState('chat'); // 'chat' | 'dashboard'
  const [isLoading, setIsLoading] = useState(false);
  const [mode, setMode] = useState('cti');
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);

  // Modals & Drawers
  const [isMatrixOpen, setIsMatrixOpen] = useState(false);
  const [isIocsOpen, setIsIocsOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSamplesOpen, setIsSamplesOpen] = useState(false);
  const [inspectedTechnique, setInspectedTechnique] = useState(null);


  // Save sessions to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.warn('Failed to save sessions to localStorage', e);
    }
  }, [sessions]);

  // Initial Data Fetch
  useEffect(() => {
    const initData = async () => {
      try {
        const [statusData, samplesData, tacticsData, techniquesData] = await Promise.allSettled([
          fetchSystemStatus(),
          fetchSamples(),
          fetchTactics(),
          fetchTechniques()
        ]);

        if (statusData.status === 'fulfilled') setSystemStatus(statusData.value);
        if (samplesData.status === 'fulfilled') setSamples(samplesData.value.samples || []);
        if (tacticsData.status === 'fulfilled') setTactics(tacticsData.value.tactics || []);
        if (techniquesData.status === 'fulfilled') setTechniques(techniquesData.value.techniques || []);
      } catch (err) {
        console.error('Initialization error:', err);
      }
    };

    initData();
    const interval = setInterval(async () => {
      try {
        const s = await fetchSystemStatus();
        setSystemStatus(s);
      } catch {}
    }, 15000);

    return () => clearInterval(interval);
  }, []);

  const activeSession = useMemo(() => {
    return sessions.find(s => s.id === activeSessionId) || sessions[0];
  }, [sessions, activeSessionId]);

  // Aggregate IOCs from active session
  const aggregatedIocs = useMemo(() => {
    if (!activeSession?.messages) return { ips: [], domains: [], hashes: [], registryKeys: [], files: [], totalCount: 0 };
    const ips = new Set();
    const domains = new Set();
    const hashes = new Set();
    const registryKeys = new Set();
    const files = new Set();

    activeSession.messages.forEach(msg => {
      if (msg.iocs) {
        msg.iocs.ips?.forEach(v => ips.add(v));
        msg.iocs.domains?.forEach(v => domains.add(v));
        msg.iocs.hashes?.sha256?.forEach(v => hashes.add(v));
        msg.iocs.hashes?.sha1?.forEach(v => hashes.add(v));
        msg.iocs.hashes?.md5?.forEach(v => hashes.add(v));
        msg.iocs.registryKeys?.forEach(v => registryKeys.add(v));
        msg.iocs.files?.forEach(v => files.add(v));
      }
    });

    return {
      ips: [...ips],
      domains: [...domains],
      hashes: [...hashes],
      registryKeys: [...registryKeys],
      files: [...files],
      totalCount: ips.size + domains.size + hashes.size + registryKeys.size + files.size
    };
  }, [activeSession]);

  const handleNewSession = () => {
    const newSession = {
      id: `session-${Date.now()}`,
      title: `Analysis ${sessions.length + 1}`,
      createdAt: new Date().toISOString(),
      messages: []
    };
    setSessions([newSession, ...sessions]);
    setActiveSessionId(newSession.id);
  };

  const handleDeleteSession = (sessionId) => {
    const updated = sessions.filter(s => s.id !== sessionId);
    if (updated.length === 0) {
      const fresh = {
        id: `session-${Date.now()}`,
        title: 'New Threat Analysis',
        createdAt: new Date().toISOString(),
        messages: []
      };
      setSessions([fresh]);
      setActiveSessionId(fresh.id);
    } else {
      setSessions(updated);
      if (activeSessionId === sessionId) {
        setActiveSessionId(updated[0].id);
      }
    }
  };

  const handleSendMessage = async (text) => {
    if (!text.trim() || isLoading) return;

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: new Date().toISOString()
    };

    // Update active session with user message
    const updatedMessages = [...(activeSession?.messages || []), userMessage];
    const sessionTitle = activeSession?.messages?.length === 0
      ? text.substring(0, 32) + (text.length > 32 ? '...' : '')
      : activeSession?.title;

    setSessions(prev =>
      prev.map(s => s.id === activeSessionId ? { ...s, title: sessionTitle, messages: updatedMessages } : s)
    );

    setIsLoading(true);

    try {
      const response = await sendChatMessage({
        message: text,
        temperature: settings.temperature,
        max_new_tokens: settings.max_new_tokens,
        mode
      });

      const aiMessage = {
        id: response.id || `ai-${Date.now()}`,
        role: 'assistant',
        content: response.raw_response,
        raw_response: response.raw_response,
        reasoning: response.reasoning,
        answer: response.answer,
        word_count: response.word_count,
        mitre: response.mitre,
        iocs: response.iocs,
        latencyMs: response.latencyMs,
        engine: response.engine,
        device: response.device,
        timestamp: response.timestamp || new Date().toISOString()
      };

      setSessions(prev =>
        prev.map(s =>
          s.id === activeSessionId ? { ...s, messages: [...updatedMessages, aiMessage] } : s
        )
      );
    } catch (err) {
      const errorMessage = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        content: `Error during CTI inference: ${err.message}`,
        reasoning: `Analysis failed: ${err.message}. Ensure the backend server is running and accessible.`,
        answer: 'T1059',
        timestamp: new Date().toISOString()
      };

      setSessions(prev =>
        prev.map(s =>
          s.id === activeSessionId ? { ...s, messages: [...updatedMessages, errorMessage] } : s
        )
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectSample = (sample) => {
    handleSendMessage(sample.instruction);
  };

  const handleInspectTechnique = async (techniqueId, existingDetails) => {
    if (existingDetails && existingDetails.description) {
      setInspectedTechnique(existingDetails);
      return;
    }
    try {
      const data = await fetchTechniqueDetails(techniqueId);
      if (data.technique) {
        setInspectedTechnique(data.technique);
      } else {
        setInspectedTechnique({ id: techniqueId, name: 'Technique Details', description: 'Technique description not cached.' });
      }
    } catch {
      setInspectedTechnique({ id: techniqueId, name: 'Technique Details', description: 'Technique description not found.' });
    }
  };

  const handleExportSession = () => {
    if (!activeSession) return;

    let mdContent = `# CyberSentinel CTI Threat Analysis Report\n\n`;
    mdContent += `**Session Title:** ${activeSession.title}\n`;
    mdContent += `**Generated:** ${new Date().toLocaleString()}\n`;
    mdContent += `**Total Messages:** ${activeSession.messages.length}\n`;
    mdContent += `**Extracted IOCs:** ${aggregatedIocs.totalCount}\n\n`;
    mdContent += `---\n\n`;

    activeSession.messages.forEach((msg, idx) => {
      if (msg.role === 'user') {
        mdContent += `### Input Log / Query #${idx + 1}\n\n\`\`\`\n${msg.content}\n\`\`\`\n\n`;
      } else {
        mdContent += `### CyberSentinel CTI Assessment\n\n`;
        if (msg.answer) {
          mdContent += `**MITRE ATT&CK Technique:** \`${msg.answer}\` ${msg.mitre?.name ? `— ${msg.mitre.name}` : ''}\n\n`;
        }
        if (msg.reasoning) {
          mdContent += `**Chain-of-Thought Reasoning:**\n\n${msg.reasoning}\n\n`;
        }
        if (msg.iocs && msg.iocs.totalCount > 0) {
          mdContent += `**Extracted Telemetry IOCs:**\n`;
          if (msg.iocs.ips?.length) mdContent += `- IPs: ${msg.iocs.ips.join(', ')}\n`;
          if (msg.iocs.domains?.length) mdContent += `- Domains: ${msg.iocs.domains.join(', ')}\n`;
          if (msg.iocs.registryKeys?.length) mdContent += `- Registry: ${msg.iocs.registryKeys.join(', ')}\n`;
          if (msg.iocs.files?.length) mdContent += `- Binaries/Scripts: ${msg.iocs.files.join(', ')}\n`;
          mdContent += `\n`;
        }
        mdContent += `---\n\n`;
      }
    });

    const blob = new Blob([mdContent], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `CyberSentinel_Report_${activeSession.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reasoningStepCount = useMemo(() => {
    if (!activeSession?.messages) return 0;
    return activeSession.messages
      .filter(m => m.role === 'assistant' && (m.reasoning || m.raw_response))
      .reduce((acc, m) => acc + parseReasoningSteps(m.reasoning || m.raw_response || '').length, 0);
  }, [activeSession]);

  return (
    <div className="app-container">
      {/* Top Header */}
      <Header
        systemStatus={systemStatus}
        currentView={currentView}
        onChangeView={setCurrentView}
        onNewSession={handleNewSession}
        onOpenMatrix={() => setIsMatrixOpen(true)}
        onOpenIocs={() => setIsIocsOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onExportSession={handleExportSession}
        iocCount={aggregatedIocs.totalCount}
        reasoningStepCount={reasoningStepCount}
      />

      {/* Main Workspace Body */}
      <div className="main-body">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={setActiveSessionId}
          onNewSession={handleNewSession}
          onDeleteSession={handleDeleteSession}
          samples={samples}
          onSelectSample={handleSelectSample}
          systemStatus={systemStatus}
          currentView={currentView}
          onChangeView={setCurrentView}
          reasoningStepCount={reasoningStepCount}
        />

        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          {currentView === 'dashboard' ? (
            <ReasoningDashboard
              messages={activeSession?.messages || []}
              systemStatus={systemStatus}
              onInspectTechnique={handleInspectTechnique}
              onClose={() => setCurrentView('chat')}
            />
          ) : (
            <>
              <ChatArea
                messages={activeSession?.messages || []}
                isLoading={isLoading}
                onSendMessage={handleSendMessage}
                onInspectTechnique={handleInspectTechnique}
                samples={samples}
              />

              <ChatInput
                onSendMessage={handleSendMessage}
                isLoading={isLoading}
                onStop={() => setIsLoading(false)}
                mode={mode}
                setMode={setMode}
                onOpenSampleProbes={() => setIsSamplesOpen(true)}
              />
            </>
          )}
        </main>
      </div>


      {/* Modals and Drawers */}
      <MitreMatrixModal
        isOpen={isMatrixOpen}
        onClose={() => setIsMatrixOpen(false)}
        tactics={tactics}
        techniques={techniques}
        onSelectTechnique={handleInspectTechnique}
      />

      <MitreDrawer
        isOpen={Boolean(inspectedTechnique)}
        onClose={() => setInspectedTechnique(null)}
        technique={inspectedTechnique}
      />

      <IocDrawer
        isOpen={isIocsOpen}
        onClose={() => setIsIocsOpen(false)}
        iocs={aggregatedIocs}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        settings={settings}
        setSettings={setSettings}
        onResetDefaults={() => setSettings(DEFAULT_SETTINGS)}
      />

      <SampleProbesModal
        isOpen={isSamplesOpen}
        onClose={() => setIsSamplesOpen(false)}
        samples={samples}
        onSelectSample={handleSelectSample}
      />
    </div>
  );
}
