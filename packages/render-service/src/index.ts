import { app } from "./app.js";

const PORT = process.env.PORT ? Number(process.env.PORT) : 4310;

app.listen(PORT, () => {
  console.log(`render-service listening on http://localhost:${PORT}`);
});
