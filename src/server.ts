import express, { Application, Request, Response } from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import authRoutes from './routes/auth';
import marketRoutes from './routes/marketplace';
import checkoutRoutes from './routes/checkout';
import artisanRoutes from './routes/artisan';
import shortletRoutes from './routes/shortlet';
import orderRoutes from './routes/order';
import adminRoutes from './routes/admin';
import reviewRoutes from './routes/reviews';
import vendorRoutes from './routes/vendor';
import logger from './utils/logger';

dotenv.config();

const app: Application = express();
const httpServer = createServer(app);

// Support multiple origins as a comma-separated list in FRONTEND_URL
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim());

const corsOptions = {
  origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    // Allow server-to-server requests (no origin) and listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
};

export const io = new SocketIO(httpServer, {
  cors: { origin: allowedOrigins, credentials: true }
});

io.on('connection', socket => {
  logger.info('Socket connected', { socketId: socket.id });

  // Client joins a room for its own orders
  socket.on('join:order', (orderId: string) => {
    socket.join(`order:${orderId}`);
    logger.info('Socket joined order room', { socketId: socket.id, orderId });
  });

  socket.on('disconnect', () => {
    logger.info('Socket disconnected', { socketId: socket.id });
  });
});

// Security Middleware
app.use(helmet());
app.use(cors(corsOptions));
app.use(cookieParser());
app.use(express.json());

// Rate Limiting
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use(limiter);

// Request logger
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/checkout', checkoutRoutes);
app.use('/api/artisans', artisanRoutes);
app.use('/api/shortlets', shortletRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/vendors', vendorRoutes);

// Health Check
app.get('/', (_req: Request, res: Response) => {
  res.send('Ayanfe Backend is running');
});

// Global Error Handler
app.use((err: any, _req: Request, res: Response, _next: express.NextFunction) => {
  logger.error('Unhandled error', { message: err.message, stack: err.stack });
  res.status(500).json({ message: 'Internal Server Error', error: process.env.NODE_ENV === 'development' ? err.message : undefined });
});

const PORT = process.env.PORT || 5000;
const server = httpServer.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
});

process.on('uncaughtException', err => {
  logger.error('UNCAUGHT EXCEPTION — shutting down', { name: err.name, message: err.message });
  process.exit(1);
});

process.on('unhandledRejection', (err: any) => {
  logger.error('UNHANDLED REJECTION — shutting down', { name: err?.name, message: err?.message });
  server.close(() => process.exit(1));
});
