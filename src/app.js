import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config, isValidApiToken } from './config.js';
import { createUserRouter } from './routes/users.js';
import { UserService } from './services/userService.js';

export function createApp({ userService = new UserService() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '32kb' }));

  // Permite solicitudes del origen configurado y responde los preflight del navegador.
  app.use((req, res, next) => {
    const origin = config.CORS_ORIGIN;
    if (origin === '*' || req.headers.origin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin === '*' ? '*' : origin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    return next();
  });

  // Limita el volumen de solicitudes y exige el token compartido en todas las rutas /api.
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false }));
  app.use('/api', (req, res, next) => {
    const authorization = req.get('authorization') ?? '';
    const [scheme, token] = authorization.split(' ');
    if (scheme !== 'Bearer' || !isValidApiToken(token)) {
      return res.status(401).json({ error: 'Token de API ausente o invalido' });
    }
    return next();
  });

  // Health queda público para que los sistemas de supervisión comprueben el proceso.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use('/api/users', createUserRouter(userService));
  app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // Oculta detalles internos al cliente y registra solo el mensaje del error en el servidor.
  app.use((error, _req, res, _next) => {
    const status = error.status ?? (error.code === 'LDAPS_REQUIRED' ? 400 : 500);
    if (status >= 500) console.error('Error de API:', error.message);
    return res.status(status).json({
      error: status >= 500 ? 'Error interno del servidor' : error.message,
      code: error.code
    });
  });
  return app;
}