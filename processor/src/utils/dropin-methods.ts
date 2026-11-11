/**
 * Drop-in is opt-in. An empty allow-list keeps the existing component-only
 * integration unchanged. Never advertise unimplemented wallet methods here.
 */
export const DROPIN_METHODS = [
  "creditcard", "sepa", "ach", "invoice", "prepayment", "paypal", "googlepay", "applepay",
] as const;

export type DropinMethod = (typeof DROPIN_METHODS)[number];

export function enabledDropinMethods(raw: string | undefined): DropinMethod[] {
  if (!raw) return [];
  const configured = raw.split(",").map((value) => value.trim().toLowerCase());
  const allowed = new Set<string>(DROPIN_METHODS);
  return [...new Set(configured)].filter((method): method is DropinMethod =>
    allowed.has(method),
  );
}
