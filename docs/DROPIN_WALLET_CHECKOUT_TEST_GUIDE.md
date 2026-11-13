# Novalnet commercetools Checkout — Drop-in + Google Pay + Apple Pay test package

Status: **staging candidate, not certified or live-wallet verified**. Created 2026-11-12.

## Scope and reference

Based on the Novalnet Google Pay / Apple Pay / Drop-in Stage 2 connector, with the later approved `custom.input4`/`inputval4` customer ID mapping and the Payment Intent `localeOf()` language fix preserved. The attached commercetools payment-integration template is the API shape reference.

This is one **Connect connector package**, containing the `enabler` (assets) and `processor` (service). Google Pay and Apple Pay appear as **standard Checkout components** or inside the **embedded Drop-in** when enabled. Standalone **Express Checkout** on product/cart pages is *not* implemented. Only one Standard Payments rendering type (Drop-in or Web Components) can be active per Checkout Application at a time.

## Corrections included

1. Enabler now requests session-authenticated `GET /operations/config`, not the non-existent `/config` route. Safe diagnostics include HTTP status and stack but not payment tokens or session credentials.
2. Capability discovery always includes `dropins`, `components`, and `express` arrays, matching the commercetools template; express is correctly `[]`.
3. The embedded Drop-in has `dropinHasSubmit = false`, owns the Pay button for non-wallet methods, and uses the native SDK button for Google Pay/Apple Pay. An explicit error prevents a generic wallet submission from silently succeeding.
4. Wallet availability is checked before showing a wallet radio option. Unsupported wallets are hidden, while other payment methods remain available.
5. Credit-card SDK initialization failures **inside the Drop-in only** block its ready callback. Standalone credit-card initialization/error behavior is unchanged.
6. Component mounting/switching failures are logged with stage/method and surfaced in a generic UI alert. Drop-in removal calls optional cleanup; wallets remove their DOM host.
7. Direct and redirect Novalnet API requests use `custom.input4 = "customer_no"` and `custom.inputval4 = String(parsedCart.customerId ?? "")`. Neither request sets `customer.customer_no`.
8. The previously approved Payment Intent `localeOf()` checks original transaction comment language and defaults to `en` for unknown locales.

## Enable safely in staging

First test with an ordinary method (no wallet SDK):

```env
NOVALNET_DROPIN_PAYMENT_METHODS=invoice
# Google Pay and Apple Pay are not listed in this Drop-in.
```

After the invoice Drop-in displays and transacts correctly, try:

```env
NOVALNET_DROPIN_PAYMENT_METHODS=invoice,creditcard,sepa,googlepay,applepay
NOVALNET_GOOGLEPAY_TEST_MODE=1
NOVALNET_APPLEPAY_TEST_MODE=1
NOVALNET_WALLET_MERCHANT_NAME=Your Shop Name
NOVALNET_WALLET_MERCHANT_COUNTRY=DE
# If assigned by Novalnet:
# NOVALNET_GOOGLEPAY_MERCHANT_ID=...
```

Use actual Novalnet test credentials and merchant settings for both wallets. The wallets require Novalnet account activation and supported device/browser configurations. Apple Pay may require merchant/domain registration. **Set the remaining wallet merchant settings and Drop-in list through the processor's standard configuration in `connect.yaml`, then redeploy as appropriate.** Separate Google Pay and Apple Pay enable flags are no longer used. Wallets can still be advertised as standalone components when merchant settings are complete, even if they are not listed in Drop-in.

Never put the payment access key (`NOVALNET_PAYMENT_ACCESS_KEY`), commercetools secret, or wallet tokens in frontend code or browser logs.

## Verify build locally (inside repository root)

```bash
cd enabler
npm ci --include=dev
npm test -- --runInBand
npm run build
ls -lh public/
cd ../processor
npm ci --include=dev
npm test -- --runInBand
npm run build
```

A `public/README.txt` placeholder is already tracked so the enabler's existing `vite build && cp dist/* public/` command has its target directory in a clean Git checkout. Do not commit generated `dist/` or built JavaScript assets unless your deployment workflow specifically requires it.

## Deploy to commercetools

1. Back up your working repo and review the changed-files ZIP (or use the complete source ZIP as a separate repository).
2. Commit only the intended changes, push to your organization's GitHub repository, and create a **new immutable tag**.
3. Update the commercetools **ConnectorStaged** to point to that tag, then request a **Preview**. Check both enabler/assets and processor/service build logs, SCA, and SAST.
4. Deploy Preview to a **test project** with correct Novalnet credentials and wallet enablement settings.
5. In Merchant Center, configure the Checkout Application's **Standard Payments** rendering type as **Drop-in**, select the embedded Novalnet integration, and activate it. To test individual components, temporarily switch the Standard Payments rendering type to **Web Components**.
6. Start with invoice-only Drop-in, then add card/SEPA, then Google Pay on a supported browser, then Apple Pay on a supported registered device/domain.

## Browser diagnostics

In Chrome/Firefox/Safari Developer Tools → Network/Console, filter `[Novalnet]` and inspect:

- `GET {processorUrl}/operations/config` should return `200` with a `dropinMethods` array. 404: stale enabler or wrong URL/processor; 401/403: Checkout session authorization; empty array: missing or empty Drop-in method list, or unavailable wallet merchant configuration.
- `GET {processorUrl}/walletConfig?paymentMethod=GOOGLEPAY` or `APPLEPAY` is session-authenticated and supplies **public SDK configuration and Cart-derived amount**, never the access key.
- `POST {processorUrl}/directPayment` must be issued **only after Novalnet's wallet authorization**. Its `paymentMethod.walletToken` must not be logged or copied into support tickets.
- If credit-card iframe initialization fails, `onDropinReady` is no longer called. Console will include `[Novalnet][Drop-in]` with `stage: mount-initial-method`.
- If the selected wallet has no native button, first check device availability and Novalnet merchant/domain activation.

## Acceptance checklist

| Case | Expected |
|---|---|
| `/operations/config` | HTTP 200, configured allow-list |
| `GET /operations/payment-components` | `dropins`, `components`, `express: []` |
| Invoice-only Drop-in | One Pay button, successful payment |
| Credit card Drop-in | Iframe renders and card initialization errors block ready callback |
| Method selection | Switch between invoice/card/SEPA, only selected component submits |
| Google Pay | Native wallet button on a supported device; provider token used server-side |
| Apple Pay | Native wallet button on supported verified device/domain |
| Unsupported wallet | Not offered in Drop-in; other methods remain |
| Wallet amount changes | Processor rejects stale Cart amount/currency |
| Guest checkout | `custom.input4 = "customer_no"`, `custom.inputval4 = ""` |
| B2C/B2B en/de | Correct language for creation, capture, refund |
| Payment Intents | Capture/refund/cancel, successful and declined paths |
| Duplicate submission/webhook | No double payment or double charge |
| Cloud validation | Build, SCA, SAST and Preview deployment pass |

## Verification limits

This package has passed isolated Drop-in interaction simulations, full TypeScript **parser** checks, YAML syntax validation, ZIP integrity checking, and inspection of key source invariants. The authoring environment cannot reach the npm registry and has no installed project dependencies, so full Jest, `vite build`, processor `tsc`, cloud Preview, Novalnet sandbox transactions, wallet-device tests and certification **have not been verified**. Test all of these in staging before any live use.

Official references:
- https://docs.commercetools.com/connect/templates/payment-integration
- https://docs.commercetools.com/checkout/connectors-and-applications
- https://github.com/commercetools/connect-payment-integration-template
