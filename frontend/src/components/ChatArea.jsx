import React, { useRef, useEffect } from 'react';
import { Shield, Sparkles, Terminal, Activity, ArrowRight, BrainCircuit } from 'lucide-react';
import ChatMessage from './ChatMessage.jsx';

export default function ChatArea({
  messages,
  isLoading,
  onSendMessage,
  onInspectTechnique,
  samples = []
}) {
  const scrollEndRef = useRef(null);

  useEffect(() => {
    scrollEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const quickPrompts = [
    {
      title: "PowerShell Encoded Cradle",
      tag: "Execution (T1059.001)",
      text: "Process 'cmd.exe' spawned 'powershell.exe -enc JABzAD0A...' and immediately executed a Base64-encoded download cradle."
    },
    {
      title: "Logon Registry Persistence",
      tag: "Persistence (T1547.001)",
      text: "The malware wrote a Run key under HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run pointing to payload.exe so it starts at logon."
    },
    {
      title: "XOR Memory Obfuscation",
      tag: "Defense Evasion (T1027)",
      text: "The dropper stored its second-stage payload as XOR-encrypted blobs inside a PE resource section and only decrypted them in dynamic memory."
    },
    {
      title: "Remote Process Injection",
      tag: "Privilege Escalation (T1055)",
      text: "The implant allocated RWX memory in explorer.exe via VirtualAllocEx and injected shellcode with CreateRemoteThread."
    }
  ];

  return (
    <div className="chat-workspace">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="welcome-screen">
            <div className="welcome-icon-wrap">
              <Shield size={32} />
            </div>
            <h1 className="welcome-title">CyberSentinel Threat Intelligence AI</h1>
            <p className="welcome-desc">
              Explainable CTI analyst model fine-tuned with <strong>GRPO (Group Relative Policy Optimization)</strong> on <strong>Qwen3-4B</strong>. Paste raw adversary logs, PowerShell telemetry, or threat snippets to generate auditable step-by-step reasoning and precise MITRE ATT&CK technique IDs.
            </p>

            <div className="quick-prompts-grid">
              {quickPrompts.map((item, idx) => (
                <div
                  key={idx}
                  className="quick-prompt-btn"
                  onClick={() => onSendMessage(item.text)}
                >
                  <div className="quick-prompt-tag">{item.tag}</div>
                  <div style={{ fontWeight: 600, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                    {item.title}
                  </div>
                  <div className="quick-prompt-text">{item.text}</div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <ChatMessage
                key={msg.id}
                message={msg}
                onInspectTechnique={onInspectTechnique}
              />
            ))}

            {isLoading && (
              <div className="message-row" style={{ opacity: 0.85 }}>
                <div className="message-avatar avatar-ai">
                  <Shield size={16} />
                </div>
                <div className="message-body">
                  <div className="message-header">
                    <span className="sender-name">CyberSentinel CTI Agent</span>
                    <span className="message-latency">evaluating policy...</span>
                  </div>
                  <div className="message-content" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <BrainCircuit size={18} className="spin-slow" style={{ color: 'var(--accent-cyber)' }} />
                    <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                      Evaluating GRPO reward policy & synthesizing MITRE ATT&CK reasoning trace...
                    </span>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
        <div ref={scrollEndRef} />
      </div>
    </div>
  );
}
