import React from 'react';
import { X, Sliders, RotateCcw } from 'lucide-react';

export default function SettingsModal({
  isOpen,
  onClose,
  settings,
  setSettings,
  onResetDefaults
}) {
  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: '540px' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-title">
            <Sliders size={18} style={{ color: 'var(--accent-cyber)' }} />
            <span>Inference & Model Settings</span>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="modal-body">
          {/* Temperature */}
          <div className="form-group">
            <div className="form-label">
              <span>Sampling Temperature: {settings.temperature}</span>
              <span style={{ color: 'var(--text-muted)' }}>0.0 = Deterministic, 1.0 = Creative</span>
            </div>
            <input
              type="range"
              className="form-range"
              min="0.0"
              max="1.0"
              step="0.05"
              value={settings.temperature}
              onChange={(e) => setSettings({ ...settings, temperature: parseFloat(e.target.value) })}
            />
          </div>

          {/* Max Tokens */}
          <div className="form-group">
            <div className="form-label">
              <span>Max New Tokens: {settings.max_new_tokens}</span>
              <span style={{ color: 'var(--text-muted)' }}>Budget for reasoning & answer</span>
            </div>
            <input
              type="range"
              className="form-range"
              min="64"
              max="512"
              step="16"
              value={settings.max_new_tokens}
              onChange={(e) => setSettings({ ...settings, max_new_tokens: parseInt(e.target.value) })}
            />
          </div>

          {/* Base Model */}
          <div className="form-group">
            <label className="form-label">
              <span>Hugging Face Base Model ID</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={settings.base_model}
              onChange={(e) => setSettings({ ...settings, base_model: e.target.value })}
            />
          </div>

          {/* Adapter Path */}
          <div className="form-group">
            <label className="form-label">
              <span>PEFT / LoRA Adapter Directory</span>
            </label>
            <input
              type="text"
              className="form-input"
              value={settings.adapter_path}
              onChange={(e) => setSettings({ ...settings, adapter_path: e.target.value })}
            />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn btn-outline" onClick={onResetDefaults}>
            <RotateCcw size={14} />
            <span>Reset Defaults</span>
          </button>
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
