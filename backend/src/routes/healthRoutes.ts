import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { k8sManager } from '../config/k8s.js';

const router = Router();

router.get('/health', async (_req: Request, res: Response) => {
  const dbStatus = mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected';
  const k8sContexts = k8sManager.getContexts();

  res.json({
    status: 'UP',
    platform: 'DevOps Intelligence DevOps Platform',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    services: {
      mongodb: {
        status: dbStatus,
        database: mongoose.connection.name,
      },
      kubernetes: {
        detectedContextsCount: k8sContexts.length,
        currentContext: k8sContexts.find((c) => c.isCurrent)?.name || 'None',
      },
    },
  });
});

export default router;
