const timestamp = () => new Date().toISOString();

export const log = {
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(`[${timestamp()}] INFO  ${msg}`, data ? JSON.stringify(data) : "");
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(`[${timestamp()}] WARN  ${msg}`, data ? JSON.stringify(data) : "");
  },
  error: (msg: string, err?: unknown) => {
    console.error(`[${timestamp()}] ERROR ${msg}`, err instanceof Error ? err.message : err ?? "");
  },
  bounty: (msg: string) => {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`[${timestamp()}] BOUNTY ${msg}`);
    console.log("=".repeat(60));
  },
};
