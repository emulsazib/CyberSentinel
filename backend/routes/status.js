import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bridge } from '../python_bridge.js';

const router = express.Router();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

router.get('/', async (req, res) => {
  const loraDir = path.resolve(__dirname, '..', '..', 'grpo_cti_tokenizer_model');
  const adaptersDir = path.resolve(__dirname, '..', '..', 'grpo_cti_lora_adapters');

  const loraExists = fs.existsSync(loraDir);
  const adaptersExists = fs.existsSync(adaptersDir);
  const bridgeStatus = await bridge.getStatus();

  res.json({
    status: 'online',
    service: 'CyberSentinel CTI Agent API',
    version: '1.0.0',
    model: {
      base_model: 'Qwen/Qwen2.5-1.5B-Instruct',
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
