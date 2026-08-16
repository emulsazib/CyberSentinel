import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, FileText, Sparkles, CornerDownLeft } from 'lucide-react';

export default function ChatInput({
  onSendMessage,
  isLoading,
  onStop,
  mode,
  setMode,
  onOpenSampleProbes
}) {
  const [input, setInput] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`;
    }
  }, [input]);

  const handleSubmit = (e) => {
    if (e) e.preventDefault();
    if (!input.trim() || isLoading) return;

    onSendMessage(input.trim());
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="chat-input-wrapper">
      <div className="input-container-inner">
        {/* Mode Selector & Quick Actions */}
        <div className="input-mode-bar">
          <div className="mode-selector">
            <button
              type="button"
              className={`mode-btn ${mode === 'cti' ? 'active' : ''}`}
              onClick={() => setMode('cti')}
            >
              CTI Snippet Mapping
            </button>
            <button
              type="button"
              className={`mode-btn ${mode === 'interactive' ? 'active' : ''}`}
              onClick={() => setMode('interactive')}
            >
              Interactive Analyst
            </button>
          </div>

          <button
            type="button"
            className="btn btn-ghost"
            style={{ fontSize: '0.72rem', padding: '3px 8px' }}
            onClick={onOpenSampleProbes}
          >
            <Sparkles size={13} style={{ color: 'var(--accent-amber)' }} />
            <span>Load Sample Probe</span>
          </button>
        </div>

        {/* Input Box */}
        <div className="input-box-relative">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            placeholder={
              mode === 'cti'
                ? "Paste threat intelligence report snippet, PowerShell execution log, or EDR telemetry..."
                : "Ask CyberSentinel about MITRE ATT&CK techniques, detection engineering, or incident investigation..."
            }
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            disabled={isLoading}
          />

          <div className="input-actions-right">
            {isLoading ? (
              <button
                type="button"
                className="btn btn-outline btn-icon"
                onClick={onStop}
                title="Cancel Inference"
              >
                <Square size={14} style={{ color: 'var(--accent-red)' }} />
              </button>
            ) : (
              <button
                type="button"
                className="send-btn"
                onClick={handleSubmit}
                disabled={!input.trim()}
                title="Send to CTI Model (Enter)"
              >
                <Send size={15} />
              </button>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.68rem', color: 'var(--text-muted)', padding: '0 4px' }}>
          <span>Press <strong>Enter</strong> to evaluate • <strong>Shift + Enter</strong> for multiline</span>
          <span>Policy: <strong>&lt;reasoning&gt;</strong> + <strong>&lt;answer&gt;</strong> format</span>
        </div>
      </div>
    </div>
  );
}
