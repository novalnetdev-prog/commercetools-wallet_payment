/**
 * Novalnet's public payment-brand image directory.
 *
 * Logos are hints only: the payment name always remains visible, and an absent
 * image is removed from the layout. Do not substitute another payment brand.
 * The payment-type aliases below only convert our Checkout method identifiers
 * to the Novalnet payment-type filename convention; no merchant configuration
 * or remote discovery request is required.
 */
export const NOVALNET_PAYMENT_LOGO_BASE = "https://cdn.novalnet.de/img/pv13/payment/";

const NOVALNET_PAYMENT_LOGO_NAMES: Record<string, string> = {
  sepa: "direct_debit_sepa",
  ach: "direct_debit_ach",
  guaranteedsepa: "guaranteed_direct_debit_sepa",
  guaranteedinvoice: "guaranteed_invoice",
  onlinebanktransfer: "online_bank_transfer",
  postfinancecard: "postfinance_card",
  creditcard: "creditcard",
};

export function novalnetLogoUrl(paymentMethod: string): string | undefined {
  const normalized = paymentMethod.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!/^[a-z0-9_]+$/.test(normalized)) return undefined;
  const filename = NOVALNET_PAYMENT_LOGO_NAMES[normalized] ?? normalized;
  return `${NOVALNET_PAYMENT_LOGO_BASE}${filename}.png`;
}

/** Inserts a logo if a safe URL can be built. Removes the image on load error. */
export function appendNovalnetLogo(
  parent: HTMLElement,
  method: string,
  className: string,
  alt = "",
): void {
  const url = novalnetLogoUrl(method);
  if (!url) return;
  const img = document.createElement("img");
  img.className = className;
  img.src = url;
  img.alt = alt;
  img.loading = "lazy";
  img.decoding = "async";
  if (!alt) img.setAttribute("aria-hidden", "true");
  img.onerror = () => {
    // A missing image must not show a broken icon or a wrong provider logo.
    img.remove();
  };
  parent.appendChild(img);
}
