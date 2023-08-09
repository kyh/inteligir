import pino, { type Logger } from "pino";

let logger: Logger;

const getLogger = () => {
  if (logger) {
    return logger;
  }

  const isDev = process.env.NODE_ENV !== "production";

  if (isDev) {
    const pretty = require("pino-pretty");

    logger = pino(
      {},
      pretty({
        colorize: true,
      }),
    );
  } else {
    logger = pino({
      browser: {},
      level: "debug",
      base: {
        env: process.env.NODE_ENV,
      },
    });
  }

  return logger;
};

export default getLogger;
