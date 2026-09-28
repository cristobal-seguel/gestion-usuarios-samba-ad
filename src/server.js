import { createApp } from './app.js';
import { config } from './config.js';

// Punto de entrada: crea la aplicación y la escucha en el puerto configurado.
const app = createApp();
const server = app.listen(config.PORT, () => {
  console.log(`API disponible en http://localhost:${config.PORT}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
// Cierra el servidor de forma ordenada al detener el proceso.
  process.on(signal, () => server.close(() => process.exit(0)));
}