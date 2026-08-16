# CyberSentinel — Mock Prompt

Copy-paste prompts for (1) recreating this project with an AI coding agent and (2) exercising the CTI analyst model. The system prompt in section 2 is the exact contract used during GRPO training — do not paraphrase it when running inference.

---

## 1. Project recreation prompt

Paste the block below into an AI coding agent to scaffold or rebuild CyberSentinel.

```text
Build CyberSentinel: an explainable Cyber Threat Intelligence (CTI) analyst
chatbot that maps unstructured threat text to MITRE ATT&CK techniques.

## Product
A local-first SOC analyst assistant. The user pastes CTI snippets, EDR logs,
or malware-behavior descriptions. The system returns:
- step-by-step reasoning inside <reasoning> tags
- a single MITRE ATT&CK technique ID inside <answer> tags (T#### or T####.###)
- enriched ATT&CK metadata (name, tactic, description)
- extracted IOCs (IPs, domains, hashes, registry keys, binaries, APIs)

It is a single-best-technique mapper, not a multi-label ranker. It is not a
penetration-testing, exploit, or malware-generation tool.

## Stack
- Frontend: React 18 + Vite 6 + vanilla CSS + lucide-react. Port 5173.
  Proxy /api → http://localhost:5001.
- Backend: Express.js (ESM) on port 5001. Serves /api/* and, if present,
  the frontend/dist SPA.
- Inference: a long-lived Python 3 JSON-RPC process (stdin/stdout, one
  JSON object per line) spawned by Node. Load Qwen/Qwen2.5-1.5B-Instruct
  + PEFT LoRA from ./grpo_cti_tokenizer_model (fallback
  ./grpo_cti_lora_adapters). Auto-detect CUDA → MPS → CPU. If torch/peft
  are missing, use a heuristic CTI engine that still emits the same XML
  contract.
- Training: Jupyter notebook malware-behavior.ipynb. Unsloth 4-bit +
  vLLM + TRL GRPOTrainer (trl==0.15.2) on tumeteor/Security-TTP-Mapping.
  Target hardware: Kaggle T4 16GB, fp16, UNSLOTH_VLLM_NO_FLASHINFER=1.

## Exact model system prompt (do not rewrite)
You are a cyber threat intelligence analyst. You are given a threat
intelligence text snippet describing adversary behavior. Identify the
single most relevant MITRE ATT&CK technique.
Think step-by-step inside <reasoning> tags and output the exact MITRE
ATT&CK ID (e.g. T1059 or T1059.001) inside <answer> tags.
Respond in EXACTLY this format and nothing else:
<reasoning>
...your step-by-step analysis...
</reasoning>
<answer>T####</answer>

User message for CTI mode: "CTI snippet:\n{text}"
Interactive chat mode sends the user message as-is (is_chat=true).

## Repo layout
/
  malware-behavior.ipynb          # GRPO training
  evaluate_cti_agent.py           # held-out probe evaluation
  grpo_cti_lora_adapters/         # PEFT LoRA weights (gitignored)
  grpo_cti_tokenizer_model/       # tokenizer + adapters (gitignored)
  backend/
    server.js                     # Express, PORT 5001
    python_bridge.js              # spawn + queue JSON-RPC to Python
    inference_service.py          # model load + generate + heuristic fallback
    routes/{status,chat,analyze,mitre,samples}.js
    utils/ioc_extractor.js
    data/mitre_database.json
  frontend/
    vite.config.js                # proxy /api → :5001
    src/App.jsx                   # sessions in localStorage
    src/components/{Header,Sidebar,ChatArea,ChatInput,ChatMessage,
                    MitreCard,MitreDrawer,MitreMatrixModal,IocDrawer,
                    ReasoningDrawer,SettingsModal,SampleProbesModal}.jsx
    src/services/api.js
    src/utils/iocExtractor.js
    src/index.css                 # dark SOC theme
  package.json                    # npm run dev / start / build

## Backend API
GET  /health
GET  /api/status                  # model_loaded, device, adapter path, uptime
GET  /api/samples                 # 8 benchmark CTI probes with expected TIDs
GET  /api/mitre/tactics
GET  /api/mitre/techniques?query=&tactic=
GET  /api/mitre/technique/:id
POST /api/chat                    # { message, temperature, max_new_tokens, mode }
                                  # mode: "cti" | "interactive"
POST /api/analyze                 # { snippet, logType } structured analysis

Chat response JSON:
{
  status, id, timestamp, latencyMs, engine, device, modelLoaded,
  raw_response, reasoning, answer, word_count, mitre, iocs, mode
}

Python JSON-RPC actions: status | generate | reload | ping
Generate timeout: 60s. Queue is serial (one in-flight request).

## GRPO rewards (training)
- format_reward_func: +1.0 if full output matches
  ^\s*<reasoning>.*?</reasoning>\s*<answer>.*?</answer>\s*$ else 0.0
- correctness_reward_func: +2.0 if extracted ID is in ground_truth else -1.0
  Exact match only (T1059 ≠ T1059.001)
- soft_format_reward_func: +0.25 per tag pair present (cold-start)

Technique ID regex: T\d{4}(?:\.\d{3})?

## UI (dark SOC console)
Palette: bg #090d14 / #0f1520 / #141b29, accent #00e599, fonts Inter +
JetBrains Mono. Shield logo. Header: live model pill (Qwen2.5-1.5B LoRA
or CTI Policy Engine + device), ATT&CK Matrix, IOC count, settings,
export markdown report, new session.

Sidebar: investigation sessions (create/delete/select), sample probes.
Chat: user log vs assistant assessment. MITRE technique badge opens a
drawer with tactic/description. Expandable chain-of-thought drawer.
Modes: CTI mapping vs interactive analyst chat. Settings: temperature
(default 0.1), max_new_tokens (256), base model, adapter path.
IOC drawer aggregates IPs/domains/hashes/registry/files across the
session with CSV export. Sessions persist under
localStorage key cybersentinel_sessions_v1.

## IOC extraction
Defang [.] → . and hxxp → http. Extract IPv4 (drop 127.0.0.1 / 0.0.0.0),
domains, SHA256/SHA1/MD5, HKCU/HKLM registry paths, exe/dll/ps1/vbs/bat
filenames, and a keyword list of suspicious APIs/tools.

## Sample probes (expected IDs)
1. PowerShell -enc download cradle          → T1059.001
2. HKCU Run key → payload.exe at logon      → T1547.001
3. XOR blobs in PE resource, decrypt in RAM → T1027
4. VirtualAllocEx + CreateRemoteThread      → T1055
5. HTTPS POST beacon + custom User-Agent    → T1071.001
6. procdump against lsass.exe               → T1003.001
7. vssadmin delete shadows + AES-256        → T1486
8. schtasks /create hourly updater.exe      → T1053.005

## Constraints
- Do not commit *.zip, *.safetensors, or grpo_cti_* weight directories.
- Do not generate exploits, payloads, or attack procedures.
- Heuristic fallback must still return the XML contract so the UI works
  without GPU or torch.
- Root scripts: "dev" runs backend+frontend together; "start" serves
  production backend (and SPA if frontend/dist exists).
```

---

## 2. CTI agent system prompt (inference contract)

This is the prompt the policy was rewarded against. Use it unchanged for `evaluate_cti_agent.py`, `inference_service.py`, and any new client.

```text
You are a cyber threat intelligence analyst. You are given a threat intelligence text snippet describing adversary behavior. Identify the single most relevant MITRE ATT&CK technique.
Think step-by-step inside <reasoning> tags and output the exact MITRE ATT&CK ID (e.g. T1059 or T1059.001) inside <answer> tags.
Respond in EXACTLY this format and nothing else:
<reasoning>
...your step-by-step analysis...
</reasoning>
<answer>T####</answer>
```

User turn (CTI mode):

```text
CTI snippet:
{paste threat text here}
```

Expected model output:

```xml
<reasoning>
1. Adversary activity observation: ...
2. Indicators: ...
3. MITRE ATT&CK mapping: ...
4. Conclusion: ...
</reasoning>
<answer>T1059.001</answer>
```

---

## 3. Mock analyst queries

Use these as UI probes, API fixtures, or eval cases. Ground-truth IDs are exact; sub-techniques do not satisfy parent IDs.

### Execution — PowerShell

**Input**

```text
Process 'cmd.exe' spawned 'powershell.exe -enc JABzAD0A...' and immediately executed a Base64-encoded download cradle to fetch second-stage code.
```

**Expected answer:** `T1059.001`

### Persistence — Registry Run Key

**Input**

```text
The malware wrote a Run key under HKCU\Software\Microsoft\Windows\CurrentVersion\Run pointing to payload.exe so it starts automatically at user logon.
```

**Expected answer:** `T1547.001`

### Defense Evasion — Obfuscated Files

**Input**

```text
The dropper stored its second-stage payload as XOR-encrypted blobs inside a PE resource section and only decrypted them in dynamic memory at runtime.
```

**Expected answer:** `T1027`

### Process Injection

**Input**

```text
After gaining a foothold, the implant allocated RWX memory in explorer.exe via VirtualAllocEx and injected shellcode with CreateRemoteThread.
```

**Expected answer:** `T1055`

### Command and Control — HTTPS Beacon

**Input**

```text
Beaconing was observed as periodic HTTPS POST requests to cdn-updates.example[.]com/api/v2/checkin with a custom User-Agent and AES payload.
```

**Expected answer:** `T1071.001`

### Credential Access — LSASS

**Input**

```text
Adversary invoked procdump.exe against lsass.exe to generate a process memory dump file and extract cached plaintext domain passwords.
```

**Expected answer:** `T1003.001`

### Impact — Ransomware

**Input**

```text
The ransomware binary executed 'vssadmin delete shadows /all /quiet' followed by rapid multi-threaded AES-256 encryption of user documents.
```

**Expected answer:** `T1486`

### Persistence — Scheduled Task

**Input**

```text
An anomalous scheduled task 'SystemTelemetryUpdate' was created via 'schtasks /create /sc hourly /tr C:\ProgramData\updater.exe' to execute every 60 minutes.
```

**Expected answer:** `T1053.005`

---

## 4. Interactive analyst chat (mode = `interactive`)

Same system prompt, but the user message is sent without the `CTI snippet:` wrapper. Example:

```text
Walk me through why this EDR event is T1055 rather than T1059, then map it anyway:

After gaining a foothold, the implant allocated RWX memory in explorer.exe via VirtualAllocEx and injected shellcode with CreateRemoteThread.
```

The UI still parses `<reasoning>` / `<answer>` and enriches the technique badge from `backend/data/mitre_database.json`.

---

## 5. Curl smoke tests

```bash
# Health
curl -s http://localhost:5001/health

# Model / adapter status
curl -s http://localhost:5001/api/status

# CTI mapping
curl -s http://localhost:5001/api/chat \
  -H 'Content-Type: application/json' \
  -d '{"message":"Process cmd.exe spawned powershell.exe -enc JABzAD0A...","mode":"cti","temperature":0.1,"max_new_tokens":256}'

# Structured analyze
curl -s http://localhost:5001/api/analyze \
  -H 'Content-Type: application/json' \
  -d '{"snippet":"Beaconing was observed as periodic HTTPS POST requests to cdn-updates.example[.]com/api/v2/checkin","logType":"network"}'
```
