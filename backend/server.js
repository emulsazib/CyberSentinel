import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

import statusRouter from './routes/status.js';
import chatRouter from './routes/chat.js';
import analyzeRouter from './routes/analyze.js';
import mitreRouter from './routes/mitre.js';
import samplesRouter from './routes/samples.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// API Routes
app.use('/api/status', statusRouter);
app.use('/api/chat', chatRouter);
app.use('/api/analyze', analyzeRouter);
app.use('/api/mitre', mitreRouter);
app.use('/api/samples', samplesRouter);

// Health Check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Serve frontend in production if built
const frontendDist = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(frontendDist, 'index.html'));
    }
  });
}

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('[Server Error]', err);
  res.status(500).json({
    status: 'error',
    message: err.message || 'Internal Server Error'
  });
});

app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` CyberSentinel Backend API Server running on port ${PORT}`);
  console.log(` Endpoint: http://localhost:${PORT}/api/status`);
  console.log(`=======================================================`);
});
