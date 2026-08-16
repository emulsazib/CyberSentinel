import express from 'express';
import { bridge } from '../python_bridge.js';
import { extractIOCs } from '../utils/ioc_extractor.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const {
    message,
    history = [],
    temperature = 0.1,
    max_new_tokens = 256,
    system_prompt,
    mode = 'cti' // 'cti' (structured log mapping) or 'interactive' (analyst conversation)
  } = req.body;

  if (!message || typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ status: 'error', message: 'Message text is required.' });
  }

  const startTime = Date.now();

  try {
    const isChat = mode === 'interactive';
    const result = await bridge.generate({
      prompt: message.trim(),
      system_prompt,
      temperature: parseFloat(temperature) || 0.1,
      max_new_tokens: parseInt(max_new_tokens) || 256,
      is_chat: isChat
    });

    const elapsedMs = Date.now() - startTime;
    const combinedText = `${message}\n${result.raw_response}`;
    const iocs = extractIOCs(combinedText);

    res.json({
      status: 'ok',
      id: `msg-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: new Date().toISOString(),
      latencyMs: elapsedMs,
      engine: result.engine,
      device: result.device,
      modelLoaded: result.model_loaded,
      raw_response: result.raw_response,
      reasoning: result.reasoning,
      answer: result.answer,
      word_count: result.word_count,
      mitre: result.mitreDetails,
      iocs,
      mode
    });
  } catch (err) {
    console.error('[Chat API Error]', err);
    res.status(500).json({
      status: 'error',
      message: err.message || 'Inference failure occurred.'
    });
  }
});

export default router;
