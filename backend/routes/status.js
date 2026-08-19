import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridge } from '../python_bridge.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEFAULT_BASE_MODEL = 'Qwen/Qwen3-4B-Instruct-2507';

router.get('/', async (req, res) => {
  const loraDir = path.resolve(__dirname, '..', '..', 'grpo_cti_tokenizer_model');
  const adaptersDir = path.resolve(__dirname, '..', '..', 'grpo_cti_lora_adapters');
  const modelsDir = path.resolve(__dirname, '..', '..', 'models');

  const loraExists = fs.existsSync(loraDir);
  const adaptersExists = fs.existsSync(adaptersDir);
  const bridgeStatus = await bridge.getStatus();

  // A GGUF in models/ (or CTI_GGUF_PATH) is what the Python side prefers, since
  // it is the only engine that fits a small-RAM host.
  let ggufAvailable = Boolean(bridgeStatus.gguf_path);
  if (!ggufAvailable && fs.existsSync(modelsDir)) {
    ggufAvailable = fs.readdirSync(modelsDir).some(f => f.endsWith('.gguf'));
  }

  res.json({
    status: 'online',
    service: 'CyberSentinel CTI Agent API',
    version: '1.0.0',
    model: {
      // Reported by the Python service so this never drifts from what is loaded.
      base_model: bridgeStatus.base_model || DEFAULT_BASE_MODEL,
      engine: bridgeStatus.engine || null,
      gguf_available: ggufAvailable,
      gguf_path: bridgeStatus.gguf_path || null,
      adapters_available: loraExists || adaptersExists,
      adapter_path: loraExists ? loraDir : (adaptersExists ? adaptersDir : null),
      device: bridgeStatus.device || 'cpu',
      model_loaded: bridgeStatus.model_loaded || false,
      ready: bridgeStatus.ready || false
    },
    uptime: process.uptime()
  });
});

export default router;
