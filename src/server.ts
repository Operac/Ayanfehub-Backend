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
import groupBuyRoutes from './routes/groupBuy';
import adminGroupBuyRoutes from './routes/adminGroupBuy';
import payoutRoutes from './routes/payout';
import disputeRoutes from './routes/dispute';
import notificationRoutes from './routes/notifications';
import cleaningRoutes from './routes/cleaning';
import partnerRoutes from './routes/partner';
import supportRoutes from './routes/support';
import logger from './utils/logger';
import { startOrderExpiryJob } from './services/orderExpiryJob';
import { startGroupBuyJobs } from './services/groupBuyJobs';

dotenv.config();

// Fail fast if critical environment variables are missing
const REQUIRED_ENV = [
  'JWT_SECRET', 'DATABASE_URL',
  'FLUTTERWAVE_SECRET_KEY', 'FLUTTERWAVE_WEBHOOK_HASH',
  'CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET',
];
for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    logger.error(`Missing required environment variable: ${key}`);
    process.exit(1);
  }
}

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

// Socket.io JWT authentication middleware
// Accepts token from: (1) handshake auth object, (2) httpOnly cookie (browser clients)
io.use((socket, next) => {
  try {
    // 1. Explicit auth token (non-browser clients / tests)
    let token = socket.handshake.auth?.token as string | undefined;

    // 2. Fall back to the httpOnly cookie sent automatically by the browser
    if (!token) {
      const cookieHeader = socket.handshake.headers.cookie ?? '';
      const match = cookieHeader.match(/(?:^|;\s*)token=([^;]+)/);
      token = match ? decodeURIComponent(match[1]) : undefined;
    }

    if (!token) return next(new Error('Authentication required'));
    const { verifyToken } = require('./utils/jwt');
    const payload = verifyToken(token);
    (socket as any).user = payload;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', socket => {
  const userId = (socket as any).user?.id as string | undefined;
  logger.info('Socket connected', { socketId: socket.id, userId });

  // Auto-join user's personal notification room
  if (userId) socket.join(`user:${userId}`);

  // Client joins a room for its own order — verify ownership before joining
  socket.on('join:order', async (orderId: string) => {
    try {
      if (!userId || typeof orderId !== 'string') return;
      const { default: prisma } = await import('./config/db');
      const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
      const isAdmin = (socket as any).user?.role === 'ADMIN';
      if (!order || (order.userId !== userId && !isAdmin)) {
        socket.emit('error', { message: 'Unauthorized' });
        return;
      }
      socket.join(`order:${orderId}`);
      logger.info('Socket joined order room', { socketId: socket.id, orderId });
    } catch (err) {
      logger.error('Socket join:order error', { err });
    }
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

// Rate Limiting — strict for auth, relaxed for everything else
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { message: 'Too many attempts, please try again later' } });
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use(limiter);

// Request logger
app.use((req, _res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/markets', marketRoutes);
app.use('/api/marketplace', marketRoutes); // Fallback alias for marketplace requests
app.use('/api/checkout', checkoutRoutes);
app.use('/api/artisans', artisanRoutes);
app.use('/api/shortlets', shortletRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/vendors', vendorRoutes);
app.use('/api/group-buy', groupBuyRoutes);
app.use('/api/admin/group-buy', adminGroupBuyRoutes);
app.use('/api/payouts', payoutRoutes);
app.use('/api/disputes', disputeRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/cleaning', cleaningRoutes);
app.use('/api/partners', partnerRoutes);
app.use('/api/support', supportRoutes);

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
  startOrderExpiryJob();
  startGroupBuyJobs();
});

process.on('uncaughtException', err => {
  logger.error('UNCAUGHT EXCEPTION — shutting down', { name: err.name, message: err.message });
  process.exit(1);
});

process.on('unhandledRejection', (err: any) => {
  logger.error('UNHANDLED REJECTION — shutting down', { name: err?.name, message: err?.message });
  server.close(() => process.exit(1));
});
