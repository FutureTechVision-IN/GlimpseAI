import express, { type Express } from "express";
import cors from "cors";
import { rateLimit } from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

function resolveCorsOrigin(): cors.CorsOptions["origin"] {
  const configured = process.env.CORS_ORIGIN?.trim();
  if (!configured || configured === "*") {
    return process.env.NODE_ENV === "production" ? false : true;
  }
  return configured.split(",").map((origin) => origin.trim()).filter(Boolean);
}

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: resolveCorsOrigin() }));
app.use(rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000),
  limit: Number(process.env.RATE_LIMIT_MAX ?? 300),
  standardHeaders: "draft-8",
  legacyHeaders: false,
}));
app.use(express.json({ limit: "150mb" }));
app.use(express.urlencoded({ extended: true, limit: "150mb" }));

app.use("/api", router);

export default app;
