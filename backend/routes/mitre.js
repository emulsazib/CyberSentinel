import express from 'express';
import { mitreDatabase } from '../python_bridge.js';

const router = express.Router();

// Get all tactics
router.get('/tactics', (req, res) => {
  res.json({
    status: 'ok',
    tactics: mitreDatabase.tactics || []
  });
});

// Get all techniques or search
router.get('/techniques', (req, res) => {
  const { query, tactic } = req.query;
  let list = Object.values(mitreDatabase.techniques || {});

  if (tactic) {
    list = list.filter(t => t.tactics && t.tactics.some(tac => tac.toLowerCase() === tactic.toLowerCase()));
  }

  if (query) {
    const q = query.toLowerCase();
    list = list.filter(t =>
      t.id.toLowerCase().includes(q) ||
      t.name.toLowerCase().includes(q) ||
      (t.description && t.description.toLowerCase().includes(q))
    );
  }

  res.json({
    status: 'ok',
    total: list.length,
    techniques: list
  });
});

// Get specific technique by ID
router.get('/technique/:id', (req, res) => {
  const tid = req.params.id.toUpperCase();
  const tech = mitreDatabase.techniques[tid];

  if (!tech) {
    // Check if parent technique exists
    const parentId = tid.split('.')[0];
    if (mitreDatabase.techniques[parentId]) {
      return res.json({
        status: 'ok',
        technique: {
          ...mitreDatabase.techniques[parentId],
          id: tid,
          subtechniqueOf: parentId
        }
      });
    }
    return res.status(404).json({ status: 'not_found', message: `Technique ${tid} not found in database.` });
  }

  res.json({
    status: 'ok',
    technique: tech
  });
});

export default router;
