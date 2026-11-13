import autoLoad from "@fastify/autoload";
import cors from "@fastify/cors";
import fastifyFormBody from "@fastify/formbody";
import Fastify from "fastify";
import fastifyRawBody from "fastify-raw-body";
import { randomUUID } from "node:crypto";
import { join } from "path";
import { config } from "../config/config";
import { requestContextPlugin } from "../libs/fastify/context/context";
import { errorHandler } from "../libs/fastify/error-handler";
import { log } from "../libs/logger";

export const setupFastify = async () => {
  const server = Fastify({
    logger: {
      level: config.loggerLevel,
    },
    genReqId: () => randomUUID().toString(),
    requestIdHeader: "x-request-id",
    requestIdLogLabel: "requestId",
  });

  server.setErrorHandler(errorHandler);


  const debugPaths = new Set([
    "/operations/config", "/operations/payment-components", "/walletConfig",
    "/directPayment", "/redirectPayment",
  ]);
  server.addHook("onResponse", async (request, reply) => {
    const path = request.url.split("?")[0];
    if (!debugPaths.has(path)) return;
    const details = {
      requestId: request.id, path, httpMethod: request.method,
      statusCode: reply.statusCode,
    };
    if (reply.statusCode >= 400) log.error("[NOVALNET_DEBUG][http.response][failed]", details);
    else log.info("[NOVALNET_DEBUG][http.response]", details);
  });

  await server.register(cors, {
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-Correlation-ID",
      "X-Request-ID",
      "X-Session-ID",
    ],
    origin: "*",
  });

  await server.register(fastifyFormBody);

  await server.register(fastifyRawBody, {
    field: "rawBody",
    global: false,
    runFirst: true,
    encoding: "utf8",
    routes: ["/novalnletWebhook"],
  });

  await server.register(requestContextPlugin);

  await server.register(autoLoad, {
    dir: join(__dirname, "plugins"),
  });

  return server;
};
