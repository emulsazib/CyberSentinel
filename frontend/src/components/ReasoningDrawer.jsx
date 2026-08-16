import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BrainCircuit, CheckCircle2, Terminal, ArrowRight, ShieldAlert } from 'lucide-react';
import { parseReasoningSteps } from '../utils/reasoningParser';

export default function ReasoningDrawer({ reasoning, wordCount = 0, technique = null }) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeStep, setActiveStep] = useState(null);

  if (!reasoning) return null;

  const steps = parseReasoningSteps(reasoning);

  return (
    <div className="reasoning-box">
      <div className="reasoning-toggle" onClick={() => setIsOpen(!isOpen)}>
        <div className="reasoning-title">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <BrainCircuit size={14} style={{ color: 'var(--accent-cyber)' }} />
          <span>Chain-of-Thought Reasoning Flow</span>
          <span className="reasoning-step-count-badge">
            {steps.length} {steps.length === 1 ? 'Step' : 'Steps'}
          </span>
        </div>
        <div className="reasoning-meta">
          {wordCount > 0 ? `${wordCount} words` : 'Neural Trace'}
        </div>
      </div>

      {isOpen && (
        <div className="reasoning-content">
          <div className="reasoning-timeline">
            {steps.map((step, idx) => (
              <div 
                key={idx} 
                className={`reasoning-step-item ${activeStep === idx ? 'active' : ''}`}
                onClick={() => setActiveStep(activeStep === idx ? null : idx)}
              >
                <div className="reasoning-step-header">
                  <div className="reasoning-step-number">
                    <span>{step.stepNumber}</span>
                  </div>
                  <div className="reasoning-step-title-wrap">
                    <span className="reasoning-step-title">{step.title}</span>
                    <span className="reasoning-step-words">{step.wordCount}w</span>
                  </div>
                </div>

                <div className="reasoning-step-body">
                  <p>{step.content}</p>
                </div>

                {idx < steps.length - 1 && <div className="reasoning-step-connector" />}
              </div>
            ))}
          </div>

          {technique && (
            <div className="reasoning-conclusion-bar">
              <CheckCircle2 size={14} style={{ color: 'var(--accent-cyber)' }} />
              <span>Resolved Policy Target:</span>
              <span className="reasoning-target-tag">{technique}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

