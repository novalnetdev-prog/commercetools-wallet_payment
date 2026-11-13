# Novalnet embedded Drop-in — compact logo tabs

## Design reference

The supplied Stripe connector creates and mounts a `StripePaymentElement` through `elements.create('payment', ...)`. Stripe.js itself renders its icons, tabs, and hosted payment fields. It does not ship a collection of payment-logo image files or hand-assemble tabs in `dropin-embedded.ts`.

The Novalnet connector has individual PSP components and assembles its own embedded Drop-in. This change makes only its Drop-in look more like a compact, tab-based payment selector:
- Horizontally scrollable, keyboard-focusable payment tiles.
- Visually distinct selected tile.
- Novalnet-provided logos sourced from the user-supplied Magento 12.5.1 module.
- Visa, Mastercard and American Express brand badges in the card panel.
- Compact centered panel and responsive spacing for mobile.
- Novalnet iframe.style strings for compact hosted card fields, only when `strictInitialization` is true (the existing Drop-in-only option).

## Logo loading

Logo PNGs are embedded as base64 image data URIs in `enabler/src/components/payment-methods/dropin/dropin-logos.ts`. This avoids missing assets with the existing `vite build && cp dist/* public/` command. The markup uses accessible text labels; brand images are decorative except the named card badges.

**Browser CSP check:** Inspect DevTools after deployment. If images are blocked due to the host Checkout `img-src` policy excluding `data:`, contact the Checkout host/CSP owner about the appropriate allow-list or migrate the logos to a permitted HTTPS origin. Do not blindly disable CSP protections.

## Source files changed

- `enabler/src/components/payment-methods/dropin/dropin.ts`
- `enabler/src/style/dropin.module.scss`
- `enabler/src/components/payment-methods/dropin/dropin-logos.ts` (new)
- `enabler/src/components/payment-methods/creditcard/creditcard.ts` (Drop-in-only SDK iframe style)
- `enabler/test/dropin.spec.ts` (added a logo loading regression test)

No `processor/` source, payment authorization, refund, Payment Intent, token, or webhook logic is changed.

## Important differences from Stripe

This is a layout/style match, **not** a copy of Stripe's Payment Element. Novalnet's iframe is hosted by Novalnet; external CSS cannot style iframe document internals. The Novalnet SDK's documented `iframe.style` configuration is used for that purpose. Apple Pay and Google Pay still use their native Novalnet SDK buttons, not a regular Pay-button submit. Stripe Link, Stripe Service Agreement and Stripe-specific one-click features have not been added.

### Build / stage validation

1. `cd enabler && npm ci --include=dev && npm test -- --runInBand && npm run build`
2. `cd ../processor && npm ci --include=dev && npm test -- --runInBand && npm run build`
3. Deploy the **same tagged connector** for enabler and processor to commercetools Connect Preview.
4. Set `NOVALNET_DROPIN_PAYMENT_METHODS=creditcard,sepa,invoice,prepayment,paypal,googlepay,applepay` (enable only account-approved methods) and select **Drop-in** as the active standard rendering type.
5. Test phone widths at 320, 375 and 430px, as well as desktop. Verify tabs scroll horizontally rather than squeezing into too-small columns.
6. Verify inactive panels are hidden, selected panel mounts, and only the selected payment method submits.
7. Test on iPhone/Safari for card field visibility and Apple Pay; test Android/Chrome for Google Pay.
8. Verify no Content Security Policy `img-src data:` violations in the console; confirm all logos appear.
9. Test in English and German; verify the credit card iframe language and styled labels.
10. Re-run all B2C/B2B credit-card/SEPA/saved-token/wallet/regression and payment webhook checks before production.

## Validation completed here

- Static TypeScript transpilation: no syntax diagnostics in the changed TS files.
- Isolated Drop-in runtime smoke test with mocked component builders: passed for logo tabs, card logos, wallet exclusion, method switching, submit and teardown.
- Archive checks and source diff: passed.
- `npm ci --offline` could not install `yocto-queue` from npm cache, so full Jest, TypeScript typecheck, Vite build and live Checkout verification were not performed.

## Production note

Do not ship to production based on the cosmetic changes alone. The newest package retains the existing diagnostic instrumentation from the previous iteration. Remove or disable diagnostic logs after troubleshooting, and retest wallet button completion in a real checkout session.
