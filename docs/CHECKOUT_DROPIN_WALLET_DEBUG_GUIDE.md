# Novalnet Checkout — Drop-in and Wallet Diagnostics (temporary staging build)

## Baseline and change scope
This debug build is based on `novalnet_connector.zip` (the package after removing `NOVALNET_GOOGLEPAY_ENABLED` and `NOVALNET_APPLEPAY_ENABLED`). It does **not** alter payment/business logic, supported methods, SDK configuration, Payment Intents, refunds, saved-token processing, webhooks, or transaction payloads. It adds observability to the new Drop-in/wallet integration and the processor routes it calls. No new environment variables are required.

Changed source files:
- `enabler/src/payment-enabler/novalnet-payment-enabler.ts`
- `enabler/src/components/payment-methods/dropin/dropin.ts`
- `enabler/src/components/payment-methods/wallet/wallet.ts`
- `enabler/src/utils/novalnet-debug.ts` (new)
- `processor/src/routes/operation.route.ts`
- `processor/src/routes/novalnet-payment.route.ts`
- `processor/src/server/server.ts`
- `enabler/test/novalnet-debug.spec.ts` (new test)

## Inspect browser output
1. Deploy both the enabler and processor from the **same Git tag**. Make sure the enabler JavaScript is rebuilt and deployed. Hard-refresh Checkout with Developer Tools open and **Disable cache** enabled.
2. In the browser Console, filter `[Novalnet][DEBUG]` and `[Novalnet][DEBUG][ERROR]`.
3. In Network, preserve log and inspect `GET /operations/config`, `GET /walletConfig?paymentMethod=...`, and `POST /directPayment` as applicable. Capture **HTTP status**, not request/response bodies or session headers.
4. In commercetools Connect Cloud processor logs, filter `[NOVALNET_DEBUG]`. Match `requestId` between browser and Cloud. All trace IDs start with `nn-`.

Browser examples (illustrative):
```
[Novalnet][DEBUG] {stage:"dropin.builder.start", count:1, type:"embedded"}
[Novalnet][DEBUG] {stage:"dropin.config.request", requestId:"nn-...", path:"/operations/config"}
[Novalnet][DEBUG] {stage:"dropin.config.response", requestId:"nn-...", status:200, ok:true}
[Novalnet][DEBUG] {stage:"dropin.mount.start", dropinId:1, ...}
[Novalnet][DEBUG] {stage:"dropin.ready.callback.start", dropinId:1, ...}
[Novalnet][DEBUG] {stage:"dropin.ready.callback.complete", dropinId:1, ...}
```
Processor examples (illustrative):
```
[NOVALNET_DEBUG][dropin.config][start] {requestId:"nn-..."}
[NOVALNET_DEBUG][dropin.config][success] {requestId:"nn-...", methodCount:1, methods:["invoice"]}
[NOVALNET_DEBUG][http.response] {requestId:"nn-...", path:"/operations/config", statusCode:200}
```
Repeated lifecycle events are sampled (events 1–8, 10, 25, 50, every 100th). This makes a React render/mount loop visible without flooding DevTools. Errors are not sampled.

## First check: isolate Drop-in from SDKs
Initially set in **staging**:
```
NOVALNET_DROPIN_PAYMENT_METHODS=invoice
```
Reload Checkout. If the generic error persists before `dropin.mount.start`, investigate the Checkout integration / builder / configuration request. If it occurs after `dropin.ready.callback.start`, investigate the Checkout readiness callback and repeated mounting.

Then test:
```
NOVALNET_DROPIN_PAYMENT_METHODS=creditcard
```
Finally test supported-device wallets separately:
```
NOVALNET_DROPIN_PAYMENT_METHODS=googlepay
# then separately:
NOVALNET_DROPIN_PAYMENT_METHODS=applepay
```
Merchant wallet settings and Novalnet activation must be valid. Device/browser availability can legitimately be false. If only a single unavailable wallet is enabled, Drop-in will have no selectable payment methods.

## Reading failures
- **No `[Novalnet][DEBUG]` events:** Checkout failed before loading/instantiating this enabler, or the deployed JS is stale. Confirm the enabler asset version and Connector Preview deployment.
- **Repeated `enabler.constructor` / `dropin.builder.start` / `dropin.mount.start` with growing counts:** likely a Checkout re-initialization/render loop. Check whether callbacks or DOM integrations cause the host to re-render. React's minified stack alone is not enough to prove the root cause.
- **`GET /operations/config` fails with 401/403:** session authentication; Cloud `[NOVALNET_DEBUG][http.response][failed]` records status even if auth prevents the handler from running.
- **Config HTTP 200 but zero methods:** `NOVALNET_DROPIN_PAYMENT_METHODS` is unset, or unsupported methods were filtered. Check Cloud `dropin.config.success` methods list.
- **`dropin.ready.callback.start` but no `.complete`:** a failure or hang in Checkout callback. Look for `dropin.mount.failed`.
- **`wallet.config.response` 400/401/500:** inspect corresponding Cloud `wallet.config.failed` / HTTP status by `requestId`.
- **`wallet.sdk.load` but no `wallet.sdk.loaded`:** CDN/CSP/script-load race. In particular, an existing script element that already fired `load` but left no `window.NovalnetPayment` may never resolve the existing loader promise. This is a *suspected* SDK-loader bug, not fixed in this diagnostic-only package.
- **`wallet.availability.result available:false` or timeout:** the wallet is not supported in this browser, merchant, domain or device configuration; do not display the button.
- **`wallet.payment.request` then HTTP error:** match the `nn-...` request ID in Cloud to find auth, validation, or Novalnet processor errors.
- **200 response but `transactionStatus: FAILURE`:** the existing processor intentionally returns an application-level decline. The wallet's catch reports it through `onError`.

## Security and log collection
Only log method name, processing stage, HTTP status, environment, counts and existence booleans. **Never share** `X-Session-ID`, customer/cart/Payment IDs, wallet tokens, payment request bodies, Novalnet keys, PSP raw responses, Sentry credentials or personal information. These are temporary diagnostics; remove them or gate them after the issue is resolved.

## Local verification
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
Then deploy as a new Git tag and verify in a real Checkout session. Syntax parsing and isolated debug-helper smoke checks were performed during package preparation; full npm tests, builds, wallet transactions and cloud deployment must be run in your environment.
