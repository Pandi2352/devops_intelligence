import express from 'express';
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';

import { connectDB } from './config/db.js';
import { seedAdminIfNone } from './controllers/authController.js';
import { seedProjectsIfNone } from './controllers/projectController.js';
import { seedClustersIfNone } from './controllers/clusterController.js';
import healthRoutes from './routes/healthRoutes.js';
import authRoutes from './routes/authRoutes.js';
import clusterRoutes from './routes/clusterRoutes.js';
import gitRoutes from './routes/gitRoutes.js';
import argoRoutes from './routes/argoRoutes.js';
import approvalRoutes from './routes/approvalRoutes.js';
import projectRoutes from './routes/projectRoutes.js';
import observabilityRoutes from './routes/observabilityRoutes.js';

dotenv.config();

const app = express();
const server = http.createServer(app);

// Setup Socket.io for live cluster events, pod streaming, and sync logs
const io = new SocketIOServer(server, {
  cors: {
    origin: true, // Allow all origins dynamically
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
});

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: false,
}));
app.use(cors({
  origin: true, // Dynamically allow any requesting origin (localhost:5173, localhost:5175, etc.)
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
}));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Realtime Socket.io handlers
io.on('connection', (socket) => {
  console.log(`[Socket.io] Client connected: ${socket.id}`);
  
  socket.on('subscribe:cluster', (clusterName) => {
    socket.join(`cluster:${clusterName}`);
    console.log(`[Socket.io] Client ${socket.id} subscribed to cluster: ${clusterName}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket.io] Client disconnected: ${socket.id}`);
  });
});

// Export io so controllers can emit live events
export { io };

// API Routes
app.use('/api', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/clusters', clusterRoutes);
app.use('/api/git', gitRoutes);
app.use('/api/argocd', argoRoutes);
app.use('/api/approvals', approvalRoutes);
app.use('/api/observability', observabilityRoutes);

// Root route
app.get('/', (_req, res) => {
  res.json({
    message: 'Welcome to KubeOrbit Centralized Kubernetes & GitOps Platform API',
    version: '1.0.0',
    documentation: '/api/health',
  });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ message: 'Endpoint not found' });
});

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  await connectDB();
  await seedAdminIfNone();
  await seedProjectsIfNone();
  await seedClustersIfNone();

  server.listen(PORT, () => {
    console.log(`🚀 [KubeOrbit Backend] Server running on http://localhost:${PORT}`);
    console.log(`📡 [Health Check] http://localhost:${PORT}/api/health`);
  });
};

startServer();
