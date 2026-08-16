import React, { useState } from 'react';
import { Copy, Check, Terminal, Volume2, Shield, User, Clock, FileCode } from 'lucide-react';
import ReasoningDrawer from './ReasoningDrawer.jsx';
import MitreCard from './MitreCard.jsx';

export default function ChatMessage({ message, onInspectTechnique }) {
  const [copied, setCopied] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const isUser = message.role === 'user';

  const handleCopy = () => {
    const textToCopy = message.raw_response || message.content || '';
    navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSpeak = () => {
    if (!('speechSynthesis' in window)) return;
    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);
      return;
    }

    const text = message.reasoning
      ? `Analysis mapped to technique ${message.answer || ''}. Summary: ${message.reasoning.substring(0, 300)}`
      : message.content;

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.05;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const formatTime = (ts) => {
    if (!ts) return '';
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <div className="message-row">
      <div className={`message-avatar ${isUser ? 'avatar-user' : 'avatar-ai'}`}>
        {isUser ? <User size={16} /> : <Shield size={16} />}
      </div>

      <div className="message-body">
        <div className="message-header">
          <span className="sender-name">{isUser ? 'Analyst' : 'CyberSentinel CTI Agent'}</span>
          <span className="message-timestamp">{formatTime(message.timestamp)}</span>
          {!isUser && message.latencyMs && (
            <span className="message-latency">
              <Clock size={10} style={{ display: 'inline', marginRight: '3px' }} />
              {message.latencyMs}ms
            </span>
          )}
        </div>

        {isUser ? (
          <div className="message-content user-bubble">
            {message.content}
          </div>
        ) : (
          <div className="message-content">
            {/* Chain of thought reasoning drawer */}
            {message.reasoning && (
              <ReasoningDrawer
                reasoning={message.reasoning}
                wordCount={message.word_count}
                technique={message.answer}
              />
            )}


            {/* MITRE technique card */}
            {message.answer && (
              <MitreCard
                answer={message.answer}
                mitreDetails={message.mitre}
                onInspectTechnique={onInspectTechnique}
              />
            )}

            {/* Raw output toggle view if requested */}
            {showRaw && (
              <div style={{
                backgroundColor: '#070b10',
                padding: '12px',
                borderRadius: '6px',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                color: '#6ee7b7',
                whiteSpace: 'pre-wrap',
                marginTop: '8px',
                border: '1px solid #1f2937'
              }}>
                {message.raw_response || message.content}
              </div>
            )}

            {/* Extracted IOCs */}
            {message.iocs && message.iocs.totalCount > 0 && (
              <div className="ioc-tags-container">
                <div style={{ width: '100%', fontSize: '0.7rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                  EXTRACTED TELEMETRY IOCs ({message.iocs.totalCount})
                </div>
                {message.iocs.ips?.map((ip, i) => (
                  <span key={`ip-${i}`} className="ioc-chip ip" title="IP Address">IP: {ip}</span>
                ))}
                {message.iocs.domains?.map((d, i) => (
                  <span key={`dom-${i}`} className="ioc-chip domain" title="Domain/Host">DOM: {d}</span>
                ))}
                {message.iocs.registryKeys?.map((rk, i) => (
                  <span key={`rk-${i}`} className="ioc-chip reg" title="Registry Key">REG: {rk}</span>
                ))}
                {message.iocs.files?.map((f, i) => (
                  <span key={`f-${i}`} className="ioc-chip file" title="Binary/Script">FILE: {f}</span>
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="message-actions-bar">
              <button className="action-icon-btn" onClick={handleCopy} title="Copy Output">
                {copied ? <Check size={12} style={{ color: 'var(--accent-cyber)' }} /> : <Copy size={12} />}
                <span>{copied ? 'Copied' : 'Copy'}</span>
              </button>

              <button
                className="action-icon-btn"
                onClick={() => setShowRaw(!showRaw)}
                title="Inspect raw XML tags"
              >
                <FileCode size={12} />
                <span>{showRaw ? 'Hide Raw' : 'Raw XML'}</span>
              </button>

              {'speechSynthesis' in window && (
                <button
                  className="action-icon-btn"
                  onClick={handleSpeak}
                  title="Read Analysis Aloud"
                >
                  <Volume2 size={12} style={{ color: speaking ? 'var(--accent-cyber)' : 'inherit' }} />
                  <span>{speaking ? 'Stop' : 'Read'}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
