import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`API disponible en http://localhost:${config.PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}