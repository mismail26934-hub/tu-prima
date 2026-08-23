import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer } from "ws";
import dotenv from "dotenv";
import {
  realtimeAdd,
  realtimeRemove,
} from "./src/lib/realtime/hub";
import { ensureSchema } from "./src/db/mysql-workbook";

dotenv.config({ path: ".env.local" });
dotenv.config();

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOSTNAME || "localhost";
const listenHost = process.env.LISTEN_HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });

async function main() {
  await ensureSchema();
  await app.prepare();
  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    void handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    realtimeAdd(socket);
    socket.on("close", () => realtimeRemove(socket));
    socket.on("error", () => realtimeRemove(socket));
  });

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

  setInterval(() => {
    for (const client of wss.clients) {
      if (client.readyState === client.OPEN) client.ping();
    }
  }, 30_000);

  server.listen(port, listenHost, () => {
    console.log(
      `TU-PRIMA ready on http://${hostname}:${port} (WebSocket ws://${hostname}:${port}/ws)`
    );
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
