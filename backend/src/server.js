import { createApp } from './app.js';
import { Database } from './db/database.js';

const port = Number.parseInt(process.env.EMRS_PORT ?? '8080', 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('EMRS_PORT must be an integer between 1 and 65535');
}

const db = new Database(process.env.EMRS_DB || 'emrs.db');
const app = createApp({ db });
const server = app.listen(port, '0.0.0.0', () => {
  console.log(`EMRS API listening on http://0.0.0.0:${port}`);
});

function shutdown() {
  server.close((error) => {
    db.close();
    if (error) {
      console.error('Failed to close HTTP server:', error);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
