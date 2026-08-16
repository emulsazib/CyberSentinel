import express from 'express';
import { bridge } from '../python_bridge.js';
import { extractIOCs } from '../utils/ioc_extractor.js';

const router = express.Router();

router.post('/', async (req, res) => {
  const { snippet, logType = 'generic', source = 'manual_input' } = req.body;

  if (!snippet || !snippet.trim()) {
    return res.status(400).json({ status: 'error', message: 'Threat snippet/log content is required.' });
  }

  const startTime = Date.now();

  try {
    const result = await bridge.generate({
      prompt: snippet.trim(),
      temperature: 0.1,
      max_new_tokens: 300,
      is_chat: false
    });

    const elapsedMs = Date.now() - startTime;
    const iocs = extractIOCs(snippet);

    res.json({
      status: 'ok',
      analysisId: `csa-${Date.now()}`,
      timestamp: new Date().toISOString(),
      latencyMs: elapsedMs,
      logType,
      source,
      prediction: {
        techniqueId: result.answer,
        reasoning: result.reasoning,
        wordCount: result.word_count,
        confidence: result.answer ? 'High (GRPO Policy Evaluated)' : 'Low',
        mitreDetails: result.mitreDetails
      },
      telemetryExtraction: {
        iocs,
        totalIocsFound: iocs.totalCount
      },
      rawResponse: result.raw_response
    });
  } catch (err) {
    console.error('[Analyze API Error]', err);
    res.status(500).json({
      status: 'error',
      message: err.message || 'Analysis processing failed.'
    });
  }
});

export default router;
