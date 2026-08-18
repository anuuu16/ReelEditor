import { createServer } from "node:http";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4310;

const server = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok" }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, () => {
  console.log(`render-service listening on http://localhost:${PORT}`);
});
