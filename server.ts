import { createServer as createHttpServer } from "http";
import { createServer as createHttpsServer } from "https";
import { createServer as createNetServer } from "net";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import {
  realtimeAdd,
  realtimeRemove,
} from "./src/lib/realtime/hub";
import { ensureSchema } from "./src/db/mysql-workbook";
import { loadLanTls, tlsEnabled } from "./src/lib/lan-tls";

dotenv.config({ path: ".env.local" });
dotenv.config();

// `npm start` must serve the production build. An inherited NODE_ENV=development
// starts Next in dev mode, which 404s nested routes such as /api/jobs/[id]/action
// and makes offline sync report "Sync failed (404)".
if (process.env.npm_lifecycle_event === "start") {
  (process.env as { NODE_ENV?: string }).NODE_ENV = "production";
}

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const listenHost = process.env.LISTEN_HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);
const useTls = tlsEnabled();

const app = next({ dev, hostname, port });

async function main() {
  await ensureSchema();
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  const onRequest = (
    req: import("http").IncomingMessage,
    res: import("http").ServerResponse
  ) => {
    const parsedUrl = parse(req.url || "/", true);
    void handle(req, res, parsedUrl);
  };

  const attachUpgrade = (server: import("http").Server) => {
    server.on("upgrade", (req, socket, head) => {
      const { pathname } = parse(req.url || "/");
      if (pathname === "/ws") {
        wss.handleUpgrade(req, socket, head, (ws) => {
          wss.emit("connection", ws, req);
        });
        return;
      }
      void upgrade(req, socket, head);
    });
  };

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    realtimeAdd(socket);
    socket.on("close", () => realtimeRemove(socket));
    socket.on("error", () => realtimeRemove(socket));
  });

  setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.ping();
    }
  }, 30_000);

  if (!useTls) {
    const server = createHttpServer(onRequest);
    attachUpgrade(server);
    server.listen(port, listenHost, () => {
      console.log(
        `TU-PRIMA ready on http://${hostname}:${port} (${dev ? "dev" : "production"} · WebSocket ws://${hostname}:${port}/ws)`
      );
    });
    return;
  }

  const tls = loadLanTls(hostname);
  const httpsServer = createHttpsServer(
    { cert: tls.cert, key: tls.key },
    onRequest
  );
  attachUpgrade(httpsServer);

  const httpServer = createHttpServer((req, res) => {
    const raw = String(req.headers.host || `${hostname}:${port}`)
      .split(",")[0]
      .trim();
    const hostName = raw.replace(/\]:?\d+$/, "").replace(/:\d+$/, "");
    const location = `https://${hostName}:${port}${req.url || "/"}`;
    res.writeHead(308, { Location: location });
    res.end();
  });

  const mux = createNetServer((socket) => {
    socket.once("data", (buf) => {
      socket.pause();
      socket.unshift(buf);
      const isTls = buf[0] === 0x16 || buf[0] === 0x80;
      const target = isTls ? httpsServer : httpServer;
      target.emit("connection", socket);
      process.nextTick(() => socket.resume());
    });
  });

  mux.listen(port, listenHost, () => {
    console.log(
      `TU-PRIMA ready on https://${hostname}:${port} (${dev ? "dev" : "production"} · HTTP redirects · wss://${hostname}:${port}/ws)`
    );
    console.log(
      `  Open HTTPS once while online so the service worker can cache offline.`
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
