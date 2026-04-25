import express from 'express';
import { createServer as createViteServer } from 'vite';
import { createServer as createHttpServer } from 'http';
import { Server } from 'socket.io';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  const server = createHttpServer(app);
  const io = new Server(server, {
    cors: { origin: '*' },
    transports: ['websocket']
  });

  const broadcasters = new Map<string, string>(); // id -> display name
  const viewerToBroadcaster = new Map<string, string>(); // viewerId -> broadcasterId

  io.on('connection', (socket) => {
    // Send current active broadcasters to newly connected socket
    socket.emit('availableBroadcasters', Array.from(broadcasters.entries()).map(([id, name]) => ({ id, name })));

    socket.on('broadcaster', (name?: string) => {
      broadcasters.set(socket.id, name || `Screen ${socket.id.substring(0, 4)}`);
      io.emit('availableBroadcasters', Array.from(broadcasters.entries()).map(([id, name]) => ({ id, name })));
      console.log(`Broadcaster started: ${socket.id}`);
    });

    socket.on('watch', (broadcasterId) => {
       const oldBroadcasterId = viewerToBroadcaster.get(socket.id);
       if (oldBroadcasterId && oldBroadcasterId !== broadcasterId) {
         // remove from old
         socket.to(oldBroadcasterId).emit('disconnectPeer', socket.id);
       }
       viewerToBroadcaster.set(socket.id, broadcasterId);
       if (broadcasters.has(broadcasterId)) {
         socket.to(broadcasterId).emit('viewer', socket.id);
       }
       updateViewerCount(broadcasterId);
       if (oldBroadcasterId && oldBroadcasterId !== broadcasterId) {
         updateViewerCount(oldBroadcasterId);
       }
    });

    socket.on('offer', (id, message) => {
      socket.to(id).emit('offer', socket.id, message);
    });

    socket.on('answer', (id, message) => {
      socket.to(id).emit('answer', socket.id, message);
    });

    socket.on('candidate', (id, message) => {
      socket.to(id).emit('candidate', socket.id, message);
    });

    socket.on('disconnect', () => {
      socket.broadcast.emit('disconnectPeer', socket.id);
      
      const wasBroadcasterId = viewerToBroadcaster.get(socket.id);
      if (wasBroadcasterId) {
        viewerToBroadcaster.delete(socket.id);
        updateViewerCount(wasBroadcasterId);
      }

      if (broadcasters.has(socket.id)) {
        broadcasters.delete(socket.id);
        io.emit('availableBroadcasters', Array.from(broadcasters.entries()).map(([id, name]) => ({ id, name })));
        io.emit('broadcasterDisconnected', socket.id);
        
        // Disconnect all viewers watching this broadcaster
        for (const [vId, bId] of viewerToBroadcaster.entries()) {
          if (bId === socket.id) {
            viewerToBroadcaster.delete(vId);
          }
        }
        console.log(`Broadcaster disconnected: ${socket.id}`);
      }
    });

    function updateViewerCount(bId: string) {
      if (!broadcasters.has(bId)) return;
      let count = 0;
      viewerToBroadcaster.forEach(v => { if (v === bId) count++; });
      io.to(bId).emit('viewerCount', count);
    }
  });

  // API routes FIRST
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok' });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // In production, Node will be running from the root but serve static files from dist
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
