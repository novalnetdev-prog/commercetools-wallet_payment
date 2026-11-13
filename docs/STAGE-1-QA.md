# Stage 1 QA — Novalnet Embedded Drop-in

**Status: implementation candidate for staging. Not production-certified.**

## Changes
- `createDropinBuilder('embedded')` wraps **existing** component builders.
- Processor advertises an `embedded` Drop-in only when `NOVALNET_DROPIN_PAYMENT_METHODS`
  contains at least one recognized existing method.
- `GET /operations/config` returns only the configured public method allow-list.
- Wallets and instalments are not implemented or advertised in this stage.
- No modifications to card tokenization, saved-payment storage, Payment Intent,
  refund, webhook, iframe, or other existing payment processing code.

## Checks performed in this environment
- Python YAML load: **PASS**.
- TypeScript transpile/syntax checks: **PASS** for changed TypeScript files.
- Allow-list cases: **PASS** in isolated Node evaluation.
- Mount, switch, submit, remove: **PASS** in an isolated mock-DOM harness.
- Byte-for-byte check on the original credit-card, saved-payment, Payment Intent,
  and original stylesheet files: **PASS**.
- Jest, Vite, processor tsc: **NOT RUN** because the npm registry is not reachable
  from this environment (`EAI_AGAIN`). Run these in your Ubuntu checkout.
- Real Novalnet test payment and commercetools Checkout rendering: **NOT TESTED**.

## Ubuntu validation before enabling

```
cd enabler
npm ci --include=dev
npm test -- --runInBand
npm run build
cd ../processor
npm ci --include=dev
npm test -- --runInBand
npm run build
```

By default Drop-in stays off. For *staging only*, set the processor's Connect
standard configuration `NOVALNET_DROPIN_PAYMENT_METHODS` to a list such as
`invoice,prepayment` (only if enabled for the merchant). Rebuild/redeploy the
processor and enabler from the same Git tag. Confirm the `/operations/payment-components`
response advertises `dropins: [{ type: "embedded" }]` only when enabled.

Test switching between card, bank and redirect methods and returning to card;
confirm no duplicate payment submissions or stale iframe/SDK state. Do not turn
on live payments until these tests pass on your desktop and iPhone devices.
