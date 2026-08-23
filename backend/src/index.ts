import express from "express";
import cors from "cors";
import { config } from "./config";
import { api } from "./api";

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "proofsure-backend" }));
app.use("/api", api);

app.listen(config.port, () => {
  console.log(`ProofSure backend listening on http://localhost:${config.port}`);
});
