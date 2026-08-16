export function parseReasoningSteps(reasoningText) {
  if (!reasoningText || typeof reasoningText !== 'string') return [];

  const raw = reasoningText.trim();
  if (!raw) return [];

  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  const steps = [];
  let currentStep = null;

  for (const line of lines) {
    const numMatch = line.match(/^(\d+)[\.\)]\s*(.*)$/) || line.match(/^Step\s+(\d+)[:\.\)]\s*(.*)$/i);
    if (numMatch) {
      if (currentStep && currentStep.content.trim()) {
        steps.push(currentStep);
      }
      currentStep = {
        stepNumber: parseInt(numMatch[1], 10) || (steps.length + 1),
        content: numMatch[2] || ''
      };
    } else if (currentStep) {
      currentStep.content += (currentStep.content ? ' ' : '') + line;
    } else {
      currentStep = {
        stepNumber: steps.length + 1,
        content: line
      };
    }
  }
  if (currentStep && currentStep.content.trim()) {
    steps.push(currentStep);
  }

  if (steps.length > 0) {
    return steps.map((s, index) => {
      const text = s.content.trim();
      return {
        stepNumber: s.stepNumber || (index + 1),
        title: inferStepTitle(text, index, steps.length),
        content: text,
        wordCount: text.split(/\s+/).filter(Boolean).length,
        category: categorizeStep(text, index, steps.length)
      };
    });
  }

  return [
    {
      stepNumber: 1,
      title: 'Adversary Behavior Analysis',
      content: raw,
      wordCount: raw.split(/\s+/).filter(Boolean).length,
      category: 'analysis'
    }
  ];
}


function inferStepTitle(text, index, total) {
  const lower = text.toLowerCase();
  if (index === 0 && (lower.includes('describes') || lower.includes('observation') || lower.includes('activity') || lower.includes('spawn') || lower.includes('malware'))) {
    return 'Behavior Observation & Telemetry';
  }
  if (lower.includes('match') || lower.includes('mitre') || lower.includes('technique') || lower.includes('aligns') || lower.includes('t1')) {
    return 'ATT&CK Technique Alignment';
  }
  if (lower.includes('evade') || lower.includes('obfusc') || lower.includes('inject') || lower.includes('persist') || lower.includes('beacon') || lower.includes('dump')) {
    return 'Tactical Indicator Analysis';
  }
  if (index === total - 1) {
    return 'Policy Decision & Verification';
  }
  return `Analytical Step ${index + 1}`;
}

function categorizeStep(text, index, total) {
  const lower = text.toLowerCase();
  if (lower.includes('mitre') || lower.includes('t10') || lower.includes('t11') || lower.includes('t15') || lower.includes('t14') || lower.includes('technique')) {
    return 'technique';
  }
  if (lower.includes('powershell') || lower.includes('registry') || lower.includes('memory') || lower.includes('beacon') || lower.includes('inject') || lower.includes('createremote')) {
    return 'indicator';
  }
  if (index === 0) {
    return 'observation';
  }
  return 'inference';
}
