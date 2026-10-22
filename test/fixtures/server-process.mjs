import { startServer } from '../../lib/server.mjs';
const started = await startServer({ port: 0, workspace: () => ({ directory: process.cwd(), note: '' }),
  page: ({ token }) => { if (process.argv[2] === 'broken-page') throw new Error('render failed'); return token; } });
process.send({ port: started.port });
process.on('message', () => { started.server.closeAllConnections(); started.server.close(() => process.disconnect()); });
