# Novalnet Checkout extension — staged implementation

## Stage 1 — Embedded Drop-in (this branch, **opt-in**)

This change introduces a commercetools Checkout `embedded` Drop-in which wraps
**existing** Novalnet payment components. It does not invent a payment provider
flow, authorize wallets, or change processor payment/refund/webhook code.

**Disabled by default.** Set `NOVALNET_DROPIN_PAYMENT_METHODS` on the processor
to a comma-separated list of methods that are **enabled in the merchant's Novalnet
account**. The initial supported list is: `creditcard,sepa,ach,invoice,prepayment,paypal`.
Do not configure a method unless that payment method is actually available to the
merchant. `GET /operations/payment-components` advertises `{dropins:[{type:'embedded'}]}`
only when at least one valid entry exists. `GET /operations/config` (session-authenticated)
returns the allow-list without private credentials.

All existing Web Component methods continue to work when Drop-in is disabled.
The Drop-in uses existing methods' `submit()` and their original processor routes.
It calls `onPayButtonClick` before submitting and `onDropinReady` after mounting.

**Requirements before production enablement:** full real-browser checkout tests,
including card SDK iframe lifecycle, changing between methods, saved-card
selection/removal, 3DS, redirects, double-submit protection, and iPhone Safari.
Test all configured methods with commercetools Checkout `showPayButton=false` and
with a custom storefront pay button. Since some existing components use global
DOM element IDs and SDK state, multi-method switching requires regression testing.

## Stage 2 — Google Pay standard Web Component

Magento 12.5.1 uses Novalnet `NovalnetPayment().createPaymentObject()`,
`setPaymentIntent`, `isPaymentMethodAvailable`, `addPaymentButton` and the
`onProcessCompletion` callback; on success it submits the resulting wallet token
to the server. The commercetools connector needs a provider-approved wallet SDK
configuration, domain/merchant configuration, a validated transaction-token
contract, and server-side amount / currency validation against the cart.
Do not expose Google Pay as a component until these are implemented and tested.

## Stage 3 — Apple Pay standard Web Component

Follow Magento's analogous wallet pattern, with Apple Pay merchant and domain
verification. Apple Pay is device/browser dependent. Do not expose until ready.

## Stage 4 — Express Payments

Commercetools Express Payments are *not* the same as a normal wallet pay button.
They require `createExpressBuilder` and wallet-originated shipping, address,
shipping-method and total-update callbacks, with cart/session creation done
server-side and the shopper's wallet token handed securely to Novalnet. Support
both cart and product page entry paths after the wallet component flows work.

## Stage 5 — Instalment Invoice / Instalment SEPA

Magento sends `instalment.cycles` and `instalment.interval = '1m'`, supports
merchant-configured cycle choices, and shows a payment plan. Implement
eligibility, customer disclosures, server-side cycles validation and appropriate
webhook/refund behavior without changing existing Invoice/SEPA flows.

## Security and certification

Do not transmit or log raw Apple/Google Pay tokens through commercetools Payment
custom fields or application logs. Keep keys server-side; use Novalnet client SDK
for wallet sheet and token exchange. Avoid committing generated assets and
credentials. Re-run Jest, build, real-provider sandbox, mobile and SCA checks.

Reference contracts: https://docs.commercetools.com/checkout/connectors-and-applications
https://docs.commercetools.com/connect/templates/payment-integration
