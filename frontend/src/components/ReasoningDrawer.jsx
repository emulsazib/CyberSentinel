import React, { useState } from 'react';
import { ChevronDown, ChevronRight, BrainCircuit, Check } from 'lucide-react';

export default function ReasoningDrawer({ reasoning, wordCount = 0 }) {
  const [isOpen, setIsOpen] = useState(true);

  if (!reasoning) return null;

  return (
    <div className="reasoning-box">
      <div className="reasoning-toggle" onClick={() => setIsOpen(!isOpen)}>
        <div className="reasoning-title">
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <BrainCircuit size={14} style={{ color: 'var(--accent-cyber)' }} />
          <span>Chain-of-Thought Reasoning</span>
        </div>
        <div className="reasoning-meta">
          {wordCount > 0 ? `${wordCount} words` : 'Analytical trace'}
        </div>
      </div>
      {isOpen && (
        <div className="reasoning-content">
          {reasoning}
        </div>
      )}
    </div>
  );
}
