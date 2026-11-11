# Stage 2: Novalnet Google Pay and Apple Pay (standard Checkout components and embedded Drop-in)

This stage combines both wallet components with Stage 1's opt-in embedded Drop-in in **one commercetools Connect connector**. `connect.yaml` continues to deploy the enabler as an assets application and processor as a service application. They build independently from the same tagged repository.

## Implementation scope

- New wallet-specific frontend components backed by `https://cdn.novalnet.de/js/v3/payment.js`, following the supplied Novalnet Magento 12.5.1 `NovalnetPayment().createPaymentObject()` integration.
- Google Pay and Apple Pay standard Web Components, with device availability checks and provider-rendered buttons.
- Drop-in may include `googlepay` and `applepay` alongside supported existing methods, but only when both the merchant flags and allow-list include them.
- New session-authenticated `GET /walletConfig?paymentMethod=GOOGLEPAY|APPLEPAY` gets Cart amount/currency from commercetools; never trusts the shopper's amount.
- Existing session-authenticated `POST /directPayment` accepts a Novalnet SDK `walletToken`. The processor maps it to `transaction.payment_data.wallet_token`, matching the supplied Magento gateway request builder. Existing card, SEPA, ACH, Payment Intent, saved-token, webhook and refund implementations are not rewritten.
- Wallet amounts/currency sent by the client must match the current authenticated Cart, or the payment is rejected **before creating a Payment**. Do not log wallet tokens or send them to analytics.
- Wallets remain disabled by default.

## Merchant Center Connect configuration

Set the existing `NOVALNET_CLIENT_KEY` and other Novalnet merchant credentials as usual. To enable wallet methods for a Novalnet test account, configure:

```dotenv
NOVALNET_GOOGLEPAY_ENABLED=1
NOVALNET_APPLEPAY_ENABLED=1
NOVALNET_WALLET_MERCHANT_NAME=Your Public Shop Name
NOVALNET_WALLET_MERCHANT_COUNTRY=DE
NOVALNET_GOOGLEPAY_MERCHANT_ID=<only-if-required-by-your-Novalnet-Google-Pay-setup>
NOVALNET_GOOGLEPAY_TEST_MODE=1
NOVALNET_APPLEPAY_TEST_MODE=1
NOVALNET_DROPIN_PAYMENT_METHODS=creditcard,sepa,googlepay,applepay
```

`NOVALNET_GOOGLEPAY_MERCHANT_ID` is optional; omit it if your Novalnet account does not require a separate partner/merchant identifier. Only enable payment methods supported by your merchant account. These variables are **not** credentials for a standalone Google Pay API integration; payment is mediated by Novalnet's wallet SDK and server APIs.

To disable immediately, set `NOVALNET_GOOGLEPAY_ENABLED=0` and `NOVALNET_APPLEPAY_ENABLED=0`. Empty `NOVALNET_DROPIN_PAYMENT_METHODS` disables Drop-in altogether, while existing Web Components remain configured as before.

## Browser/device and hosting prerequisites

- **HTTPS** storefront/Checkout, compatible browser and wallet, supported region/currency, and merchant/PSP wallet activation.
- **Apple Pay** requires Apple merchant/domain verification for the actual origin where the SDK wallet button appears, including Checkout-hosted origins if relevant. Test using a supported Apple device/browser with a wallet card. Do not force-display Apple Pay on devices on which the SDK reports it unavailable.
- **Google Pay** requires a supported browser/device and valid Novalnet wallet merchant configuration.
- Ensure the storefront's Content Security Policy allows Novalnet wallet SDK (`cdn.novalnet.de`) and the domains documented by Novalnet/Apple/Google for wallet execution. Exact CSP depends on the host environment; this connector does not change hosting CSP.
- Each wallet uses the vendor-native button. The Drop-in generic Pay button is hidden when a wallet is selected; do not call `submit()` to initiate wallet authentication.
- **Express Checkout from Cart or product pages is NOT implemented in this stage.** It needs dedicated `createExpressBuilder` and Cart/Shipping orchestration per Checkout Express Payments contracts. Do not advertise Express until it is implemented.

## Required local verification

```bash
cd enabler && npm ci --include=dev && npm test -- --runInBand && npm run build
cd ../processor && npm ci --include=dev && npm test -- --runInBand && npm run build
```

Before tagging for commercetools Connect, run `npm ls` and `npm audit` in both applications and scan generated lockfiles. Verify `enabler/public/README.txt` is committed; the enabler build script copies assets to that existing directory. Re-run Connect preview SCA/SAST after tagging.

## Sandbox acceptance checklist

1. With flags off: neither wallet is advertised; all existing payment methods and Drop-in behavior are unchanged.
2. With only Google Pay enabled: Google Pay can be mounted as Web Component; if listed in Drop-in, it renders only on supported devices.
3. With only Apple Pay enabled: corresponding behavior, with verified Apple Pay domain.
4. With both enabled: both offered in the **same connector version**; selected Drop-in wallet renders the provider button; generic Pay button is hidden.
5. On unsupported devices: SDK availability prevents wallet button display.
6. On payment completion: SDK one-time token is sent to authenticated processor; backend verifies current cart amount and currency, then passes `wallet_token` to Novalnet.
7. Cart changes between wallet sheet preparation and payment: backend rejects the stale amount; no second charge.
8. Error/decline: SDK `bookingResult` receives failure, Checkout receives `onError`, and no `onComplete` is called.
9. Redirect from Novalnet: pending payment and return URLs work; verify order state and webhook idempotency.
10. Manual test: English/German checkout, B2C and B2B, Android/Chrome Google Pay, macOS/iOS/Safari Apple Pay, refund and capture after wallet payment.

**Release gate:** The provided Magento integration is a reference for the SDK API and `wallet_token` mapping, but no live Novalnet account or physical wallet devices are connected here. Treat this as a staging candidate. Confirm the SDK's actual callbacks and response schema against your merchant sandbox before publishing to production or certifying.
