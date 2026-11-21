const prefix = "[Silicon Bricks]";

export const logger = {
  warn(message, context) {
    console.warn(prefix, message, context);
  },
  error(message, context) {
    console.error(prefix, message, context);
  },
};
