const API_BASE = '/api';

export async function fetchSystemStatus() {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

export async function fetchSamples() {
  const res = await fetch(`${API_BASE}/samples`);
  if (!res.ok) throw new Error(`Samples fetch failed (${res.status})`);
  return res.json();
}

export async function fetchTactics() {
  const res = await fetch(`${API_BASE}/mitre/tactics`);
  if (!res.ok) throw new Error(`Tactics fetch failed (${res.status})`);
  return res.json();
}

export async function fetchTechniques(params = {}) {
  const query = new URLSearchParams(params).toString();
  const res = await fetch(`${API_BASE}/mitre/techniques${query ? `?${query}` : ''}`);
  if (!res.ok) throw new Error(`Techniques fetch failed (${res.status})`);
  return res.json();
}

export async function fetchTechniqueDetails(techniqueId) {
  const res = await fetch(`${API_BASE}/mitre/technique/${techniqueId}`);
  if (!res.ok) throw new Error(`Technique details fetch failed (${res.status})`);
  return res.json();
}

export async function sendChatMessage({
  message,
  history = [],
  temperature = 0.1,
  max_new_tokens = 512,
  system_prompt,
  mode = 'cti'
}) {
  const res = await fetch(`${API_BASE}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      history,
      temperature,
      max_new_tokens,
      system_prompt,
      mode
    })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Chat request failed (${res.status})`);
  }

  return res.json();
}

export async function analyzeThreatSnippet(snippet, logType = 'generic') {
  const res = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ snippet, logType })
  });

  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.message || `Analysis request failed (${res.status})`);
  }

  return res.json();
}
