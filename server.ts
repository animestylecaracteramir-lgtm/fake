import express from 'express';
import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import { defaultWorkspace } from './server/workspace';
import { defaultToolRegistry } from './server/tools/registry';
import { defaultAgentCore } from './server/agent/agent_core';
import { defaultLLMClient } from './server/llm/client';
import { VerificationTestSuite } from './server/tests/suite';
import { V2RayBuilder } from './server/v2ray/builder';
import { V2RayValidator } from './server/v2ray/validator';
import { defaultKnowledgeStore } from './server/memory/knowledge_store';

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Enable CORS headers for localhost and iframe embedded previews
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
      return res.sendStatus(200);
    }
    next();
  });

  // SSE Clients
  const sseClients: express.Response[] = [];

  defaultAgentCore.subscribe((event) => {
    const dataStr = `data: ${JSON.stringify(event)}\n\n`;
    sseClients.forEach((client) => {
      try {
        client.write(dataStr);
      } catch {}
    });
  });

  // --- API ROUTES ---

  // Health Check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // SSE Event Stream for Live Agent Activity
  app.get('/api/agent/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Send current state on connect
    res.write(`data: ${JSON.stringify({ type: 'initial_state', payload: defaultAgentCore.getState() })}\n\n`);

    sseClients.push(res);

    req.on('close', () => {
      const idx = sseClients.indexOf(res);
      if (idx !== -1) sseClients.splice(idx, 1);
    });
  });

  // Agent Controls
  app.get('/api/agent/state', (req, res) => {
    res.json(defaultAgentCore.getState());
  });

  app.post('/api/agent/start', async (req, res) => {
    let { goal } = req.body;
    if (!goal && req.body && Object.keys(req.body).length > 0) {
      goal = JSON.stringify(req.body, null, 2);
    }
    if (!goal) {
      return res.status(400).json({ error: 'Goal is required.' });
    }
    if (typeof goal === 'object') {
      goal = JSON.stringify(goal, null, 2);
    } else if (typeof goal !== 'string') {
      goal = String(goal);
    }

    defaultAgentCore.start(goal).catch((err) => {
      console.error('Agent execution error:', err);
    });

    res.json({ message: 'Agent started successfully.', goal });
  });

  app.post('/api/agent/pause', (req, res) => {
    defaultAgentCore.pause();
    res.json({ message: 'Agent paused.', state: defaultAgentCore.getState() });
  });

  app.post('/api/agent/resume', (req, res) => {
    defaultAgentCore.resume();
    res.json({ message: 'Agent resumed.', state: defaultAgentCore.getState() });
  });

  app.post('/api/agent/stop', (req, res) => {
    defaultAgentCore.stop();
    res.json({ message: 'Agent stopped.', state: defaultAgentCore.getState() });
  });

  app.post('/api/agent/clear', (req, res) => {
    defaultAgentCore.clear();
    res.json({ message: 'Agent state cleared.', state: defaultAgentCore.getState() });
  });

  // Tools API
  app.get('/api/tools', (req, res) => {
    const category = req.query.category as string | undefined;
    const tools = defaultToolRegistry.listTools(category);
    res.json({ tools });
  });

  app.post('/api/tools/execute', async (req, res) => {
    const { name, args } = req.body;
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });
    const result = await defaultToolRegistry.executeTool(name, args || {});
    res.json(result);
  });

  app.post('/api/tools/create', async (req, res) => {
    const result = await defaultToolRegistry.executeTool('create_tool', req.body);
    res.json(result);
  });

  app.post('/api/tools/rollback', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });
    const success = defaultToolRegistry.rollbackTool(name);
    res.json({ success, message: success ? `Tool '${name}' rolled back to previous version.` : `Rollback failed or no backup found for '${name}'.` });
  });

  app.post('/api/tools/quarantine', (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Tool name is required.' });
    const success = defaultToolRegistry.quarantineTool(name);
    res.json({ success, message: success ? `Tool '${name}' quarantined.` : `Quarantine failed.` });
  });

  // Knowledge & Memory API
  app.get('/api/knowledge/diagnostics', (req, res) => {
    res.json(defaultKnowledgeStore.getDiagnostics());
  });

  app.get('/api/knowledge/experiences', (req, res) => {
    const taskType = req.query.taskType as string | undefined;
    const goal = req.query.goal as string | undefined;
    const experiences = defaultKnowledgeStore.queryExperiences({ taskType, goal, limit: 50 });
    res.json({ experiences });
  });

  app.get('/api/knowledge/strategies', (req, res) => {
    const taskType = (req.query.taskType as string) || 'general';
    const strategies = defaultKnowledgeStore.getRankedStrategies(taskType);
    res.json({ strategies });
  });

  app.get('/api/knowledge/evaluations', (req, res) => {
    const limit = parseInt((req.query.limit as string) || '20');
    const evaluations = defaultKnowledgeStore.getEvaluations(limit);
    res.json({ evaluations });
  });

  app.get('/api/memory', (req, res) => {
    const query = (req.query.q as string) || '';
    const memoryFiles = defaultWorkspace.listFiles('memory', true);
    const documents: any[] = [];

    for (const f of memoryFiles) {
      if (f.name.endsWith('.json')) {
        try {
          const raw = defaultWorkspace.readFile(f.path);
          const parsed = JSON.parse(raw);
          if (!query || JSON.stringify(parsed).toLowerCase().includes(query.toLowerCase())) {
            documents.push({ file: f.path, data: parsed, modified: f.modified });
          }
        } catch {}
      }
    }

    res.json({ documents, diagnostics: defaultKnowledgeStore.getDiagnostics() });
  });

  // Outputs & Artifacts API
  app.get('/api/outputs', (req, res) => {
    const files = defaultWorkspace.listFiles('outputs', false);
    const artifacts: any[] = [];

    for (const f of files) {
      if (!f.name.endsWith('.meta.json')) {
        let meta = null;
        const metaPath = `outputs/${f.name}.meta.json`;
        if (defaultWorkspace.fileExists(metaPath)) {
          try {
            meta = JSON.parse(defaultWorkspace.readFile(metaPath));
          } catch {}
        }
        artifacts.push({
          name: f.name,
          path: f.path,
          size: f.size,
          modified: f.modified,
          meta,
        });
      }
    }

    res.json({ artifacts });
  });

  app.get('/api/outputs/:filename', (req, res) => {
    const filename = req.params.filename;
    try {
      const content = defaultWorkspace.readFile(`outputs/${filename}`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(content);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // Workspace File Browser
  app.get('/api/workspace/files', (req, res) => {
    const dir = (req.query.dir as string) || '';
    const files = defaultWorkspace.listFiles(dir, false);
    res.json({ currentDir: dir, files });
  });

  app.get('/api/workspace/file', (req, res) => {
    const filepath = req.query.path as string;
    if (!filepath) return res.status(400).json({ error: 'Path is required' });
    try {
      const content = defaultWorkspace.readFile(filepath);
      res.json({ path: filepath, content });
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  });

  // Settings API
  app.get('/api/settings', (req, res) => {
    res.json(defaultLLMClient.getSettings());
  });

  app.post('/api/settings', (req, res) => {
    defaultLLMClient.updateSettings(req.body);
    res.json({ message: 'Settings updated successfully', settings: defaultLLMClient.getSettings() });
  });

  // V2Ray Builder Direct API
  app.post('/api/v2ray/build', (req, res) => {
    try {
      const result = V2RayBuilder.buildConfig(req.body);
      const validation = V2RayValidator.validate(result.config);
      res.json({ ...result, validation });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  });

  app.post('/api/v2ray/validate', (req, res) => {
    try {
      const config = typeof req.body.config === 'string' ? JSON.parse(req.body.config) : req.body.config;
      const validation = V2RayValidator.validate(config);
      res.json({ validation });
    } catch (err: any) {
      res.status(400).json({ error: `JSON Parse error: ${err.message}` });
    }
  });

  // Test Suite API
  app.post('/api/tests/run', async (req, res) => {
    try {
      const suiteResults = await VerificationTestSuite.runAllTests();
      res.json(suiteResults);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- VITE MIDDLEWARE SETUP ---
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Self-Evolving Autonomous Agent server running on port ${PORT}`);
  });
}

startServer().catch(console.error);
