import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// CPU-only hosts can need minutes per response; deployments raise this via env.
const INFERENCE_TIMEOUT_MS = Number(process.env.CTI_TIMEOUT_MS) || 120000;

// Load MITRE database for fast lookups and enrichments
const mitreDbPath = path.join(__dirname, 'data', 'mitre_database.json');
let mitreData = { tactics: [], techniques: {} };
try {
  const raw = fs.readFileSync(mitreDbPath, 'utf8');
  mitreData = JSON.parse(raw);
} catch (err) {
  console.error('[Bridge] Failed to load mitre_database.json:', err.message);
}

class PythonBridge {
  constructor() {
    this.process = null;
    this.queue = [];
    this.activeRequest = null;
    this.status = {
      model_loaded: false,
      device: 'initializing',
      ready: false
    };
    this.initProcess();
  }

  initProcess() {
    const scriptPath = path.join(__dirname, 'inference_service.py');
    const venvPython = path.resolve(__dirname, '..', '.venv', 'bin', 'python');
    const pythonCmd = fs.existsSync(venvPython) ? venvPython : 'python3';

    console.log(`[Bridge] Starting Python neural inference service with interpreter: ${pythonCmd}...`);

    this.process = spawn(pythonCmd, [scriptPath], {
      cwd: __dirname,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: '1'
      }
    });


    let buffer = '';

    this.process.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep remainder

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line.trim());
          this.handleResponse(parsed);
        } catch (e) {
          console.error('[Bridge] JSON parse error from Python:', line, e);
        }
      }
    });

    this.process.stderr.on('data', (data) => {
      const msg = data.toString();
      process.stderr.write(`[Python] ${msg}`);
      if (msg.includes('Neural CTI model & LoRA weights successfully loaded') || msg.includes('ready')) {
        this.status.ready = true;
        this.status.model_loaded = true;
      }
    });

    this.process.on('close', (code) => {
      console.warn(`[Bridge] Python process exited with code ${code}. Restarting in 3s...`);
      this.status.ready = false;
      this.status.model_loaded = false;
      setTimeout(() => this.initProcess(), 3000);
    });

    this.process.on('error', (err) => {
      console.error('[Bridge] Failed to start Python process:', err);
    });

    // Check status after loading delay
    setTimeout(() => {
      this.sendRaw({ action: 'status' })
        .then((res) => {
          this.status = { ...this.status, ...res, ready: true };
          console.log('[Bridge] Python inference bridge status updated:', this.status);
        })
        .catch(() => {});
    }, 2500);
  }

  sendRaw(payload) {
    return new Promise((resolve, reject) => {
      const item = {
        payload,
        resolve,
        reject,
        timeout: setTimeout(() => {
          this.queue = this.queue.filter(q => q !== item);
          if (this.activeRequest === item) {
            this.activeRequest = null;
            this.processNext();
          }
          reject(new Error(`Inference request timeout (${Math.round(INFERENCE_TIMEOUT_MS / 1000)}s)`));
        }, INFERENCE_TIMEOUT_MS)
      };

      this.queue.push(item);
      this.processNext();
    });
  }

  processNext() {
    if (this.activeRequest || this.queue.length === 0) return;
    if (!this.process || !this.process.stdin.writable) return;

    this.activeRequest = this.queue.shift();
    try {
      const jsonStr = JSON.stringify(this.activeRequest.payload) + '\n';
      this.process.stdin.write(jsonStr);
    } catch (err) {
      clearTimeout(this.activeRequest.timeout);
      this.activeRequest.reject(err);
      this.activeRequest = null;
      this.processNext();
    }
  }

  handleResponse(response) {
    if (!this.activeRequest) return;
    clearTimeout(this.activeRequest.timeout);
    const { resolve, reject } = this.activeRequest;
    this.activeRequest = null;

    if (response.status === 'error') {
      reject(new Error(response.message || 'Inference error'));
    } else {
      resolve(response);
    }

    this.processNext();
  }

  getStatus() {
    return this.status;
  }


  async generate(options = {}) {
    const {
      prompt,
      system_prompt,
      temperature = 0.1,
      max_new_tokens = 256,
      is_chat = false
    } = options;

    const res = await this.sendRaw({
      action: 'generate',
      prompt,
      system_prompt,
      temperature,
      max_new_tokens,
      is_chat
    });

    // Enrich with MITRE data if technique ID is present
    const answerId = res.answer ? res.answer.trim().toUpperCase() : null;
    let mitreDetails = null;

    if (answerId && mitreData.techniques[answerId]) {
      mitreDetails = mitreData.techniques[answerId];
    } else if (answerId) {
      // Find parent technique if subtechnique wasn't in db
      const parentId = answerId.split('.')[0];
      if (mitreData.techniques[parentId]) {
        mitreDetails = {
          ...mitreData.techniques[parentId],
          id: answerId,
          subtechniqueOf: parentId
        };
      }
    }

    return {
      ...res,
      mitreDetails
    };
  }
}

export const bridge = new PythonBridge();
export const mitreDatabase = mitreData;
