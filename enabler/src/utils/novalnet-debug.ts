/** Temporary Checkout diagnostics. Never pass customer data, session IDs, PSP payloads,
 * wallet tokens, addresses or secret keys into these methods.
 * Repeated lifecycle events are sampled to prevent console flooding during render loops.
 */
const eventCounts = new Map<string, number>();

export function novalnetDebug(stage: string, details: Record<string, unknown> = {}): void {
  const count = (eventCounts.get(stage) ?? 0) + 1;
  eventCounts.set(stage, count);
  if (count <= 8 || count === 10 || count === 25 || count === 50 || count % 100 === 0) {
    console.log("[Novalnet][DEBUG]", { stage, count, ...details });
  }
}

export function novalnetDebugError(
  stage: string,
  error: unknown,
  details: Record<string, unknown> = {},
): void {
  console.error("[Novalnet][DEBUG][ERROR]", {
    stage,
    ...details,
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : "Unknown error",
    stack: error instanceof Error ? error.stack : undefined,
  });
}

/** A non-secret ID echoed in x-request-id for matching browser and cloud logs. */
export function novalnetDebugRequestId(): string {
  const uuid = typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `nn-${uuid}`;
}
