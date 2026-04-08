import { buildApp } from "./app";
import { WebSocketServer, type WebSocket } from "ws";
import { URL } from "node:url";

const app = buildApp();
const HOST = "0.0.0.0";
const MAX_PORT_RETRIES = 10;

const start = async () => {
  try {
    await app.ready();
    const envPort = Number(process.env.PORT);
    let selectedPort = Number.isFinite(envPort) && envPort > 0 ? envPort : app.config.PORT;

    for (let attempt = 0; attempt <= MAX_PORT_RETRIES; attempt += 1) {
      try {
        await app.listen({ port: selectedPort, host: HOST });

        const wss = new WebSocketServer({ server: app.server, path: "/ws/teleconsult" });
        const rooms = new Map<string, Set<WebSocket>>();

        const broadcast = (sessionId: string, payload: Record<string, unknown>, exclude?: WebSocket) => {
          const members = rooms.get(sessionId);
          if (!members) return;
          const message = JSON.stringify(payload);
          members.forEach((client) => {
            if (client !== exclude && client.readyState === client.OPEN) {
              client.send(message);
            }
          });
        };

        wss.on("connection", (ws, req) => {
          const requestUrl = new URL(req.url ?? "", "http://localhost");
          const sessionId = requestUrl.searchParams.get("sessionId") ?? "unknown";
          const participantId = requestUrl.searchParams.get("participantId") ?? "unknown";
          const role = requestUrl.searchParams.get("role") ?? "participant";

          if (!rooms.has(sessionId)) {
            rooms.set(sessionId, new Set());
          }
          rooms.get(sessionId)!.add(ws);

          broadcast(sessionId, { type: "peer-joined", sessionId, participantId, role }, ws);

          ws.on("message", (raw) => {
            try {
              const data = JSON.parse(raw.toString()) as Record<string, unknown>;
              broadcast(sessionId, { ...data, sessionId, participantId, role }, ws);
            } catch {
              // ignore malformed payloads
            }
          });

          ws.on("close", () => {
            const members = rooms.get(sessionId);
            if (members) {
              members.delete(ws);
              if (!members.size) rooms.delete(sessionId);
            }
            broadcast(sessionId, { type: "peer-left", sessionId, participantId, role });
          });
        });

        app.log.info(`WebRTC signaling ready at ws://localhost:${selectedPort}/ws/teleconsult`);
        app.log.info(`Backend running on http://localhost:${selectedPort}`);
        return;
      } catch (error) {
        const listenError = error as NodeJS.ErrnoException;
        const isPortConflict = listenError?.code === "EADDRINUSE";
        if (!isPortConflict || attempt === MAX_PORT_RETRIES) {
          throw error;
        }
        app.log.warn(`Port ${selectedPort} is in use. Retrying with port ${selectedPort + 1}...`);
        selectedPort += 1;
      }
    }
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
