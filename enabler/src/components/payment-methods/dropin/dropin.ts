import type {
  DropinOptions,
  DropinComponent,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
} from "../../../payment-enabler/payment-enabler";
import styles from "../../../style/dropin.module.scss";
import { ACH_BANK_ICON, DROPIN_PAYMENT_LOGOS } from "./dropin-logos";
import { novalnetDebug, novalnetDebugError } from "../../../utils/novalnet-debug";

export const DROPIN_LABELS: Record<string, { en: string; de: string }> = {
  creditcard: { en: "Credit/Debit Cards", de: "Kredit-/Debitkarten" },
  sepa: { en: "Direct Debit SEPA", de: "SEPA-Lastschrift" },
  ach: { en: "Direct Debit ACH", de: "ACH-Lastschrift" },
  invoice: { en: "Invoice", de: "Rechnung" },
  prepayment: { en: "Prepayment", de: "Vorkasse" },
  paypal: { en: "PayPal", de: "PayPal" },
  googlepay: { en: "Google Pay", de: "Google Pay" },
  applepay: { en: "Apple Pay", de: "Apple Pay" },
};

const isWallet = (method: string): boolean => method === "googlepay" || method === "applepay";
let nextDropinId = 0;

function logFailure(stage: string, method: string | undefined, error: unknown): void {
  // Do not log PSP payloads, wallet tokens, cart data, or Checkout session IDs.
  console.error("[Novalnet][Drop-in]", {
    stage,
    method,
    message: error instanceof Error ? error.message : "Payment component error",
    stack: error instanceof Error ? error.stack : undefined,
  });
}

export class NovalnetDropinBuilder implements PaymentDropinBuilder {
  // The embedded Drop-in owns a Pay button for ordinary methods and the
  // Novalnet SDK owns each wallet button. Checkout must not create a second
  // generic submission button for this mixed-method integration.
  readonly dropinHasSubmit = false;

  constructor(
    private readonly methods: string[],
    private readonly createBuilder: (type: string) => Promise<PaymentComponentBuilder>,
    private readonly locale: "en" | "de",
  ) {}

  build(config: DropinOptions): DropinComponent {
    novalnetDebug("dropin.build", {
      methodCount: this.methods.length, methods: this.methods,
      hostShowsPayButton: config.showPayButton,
      dropinHasSubmit: this.dropinHasSubmit,
    });
    return new NovalnetDropin(this.methods, this.createBuilder, this.locale, config);
  }
}

/**
 * Embedded Drop-in wrapping the existing Novalnet components. The original
 * direct/redirect payment processing and PSP request formats are unchanged.
 */
export class NovalnetDropin implements DropinComponent {
  private root?: HTMLElement;
  private payButton?: HTMLButtonElement;
  private errorElement?: HTMLElement;
  private selected?: string;
  private readonly components = new Map<string, PaymentComponent>();
  private readonly prepared = new Map<string, PaymentComponent>();
  private readonly panels = new Map<string, HTMLElement>();
  private readonly radios = new Map<string, HTMLInputElement>();
  private readonly methodLabels = new Map<string, HTMLLabelElement>();
  private mounting?: Promise<void>;
  private submitting = false;
  private switching = false;
  private readonly id = ++nextDropinId;

  constructor(
    private readonly methods: string[],
    private readonly createBuilder: (type: string) => Promise<PaymentComponentBuilder>,
    private readonly locale: "en" | "de",
    private readonly config: DropinOptions,
  ) {}

  async mount(selector: string): Promise<void> {
    novalnetDebug("dropin.mount.start", { dropinId: this.id, methodCount: this.methods.length, alreadyMounted: Boolean(this.root) });
    if (this.root) throw new Error("Novalnet Drop-in is already mounted");
    const container = document.querySelector(selector);
    if (!container) throw new Error(`Drop-in container not found: ${selector}`);
    if (!this.methods.length) throw new Error("No Novalnet Drop-in methods configured");

    // Do not offer Apple Pay/Google Pay when the native wallet is unavailable.
    // A failure of one wallet must not hide the remaining non-wallet methods.
    const availableMethods: string[] = [];
    for (const method of this.methods) {
      if (isWallet(method)) {
        try {
          novalnetDebug("dropin.wallet.probe", { dropinId: this.id, method });
          const builder = await this.createBuilder(method);
          const component = builder.build({
            showPayButton: false,
            onPayButtonClick: this.config.onPayButtonClick,
          });
          const available = Boolean(component.isAvailable && (await component.isAvailable()));
          novalnetDebug("dropin.wallet.probe.result", { dropinId: this.id, method, available });
          if (!available) {
            console.info("[Novalnet][Drop-in] Wallet unavailable on this device", { method });
            continue;
          }
          this.prepared.set(method, component);
        } catch (error) {
          logFailure("wallet-availability", method, error);
          continue;
        }
      }
      availableMethods.push(method);
    }
    novalnetDebug("dropin.mount.methods", { dropinId: this.id, availableMethods });
    if (!availableMethods.length) {
      throw new Error("No configured Novalnet payment method is available on this device");
    }

    const root = document.createElement("div");
    root.className = styles.dropin;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", this.locale === "de" ? "Zahlungsart" : "Payment method");
    this.root = root;
    container.appendChild(root);

    // The tab selector, logos, and panel shell are ours; the sensitive payment
    // fields and native wallet buttons remain owned by the existing components.
    const methodList = document.createElement("div");
    methodList.className = styles.methodList;
    methodList.setAttribute("role", "radiogroup");
    methodList.setAttribute("aria-label", this.locale === "de" ? "Zahlungsart wählen" : "Choose payment method");
    root.appendChild(methodList);

    for (const method of availableMethods) {
      const label = document.createElement("label");
      label.className = styles.method;
      label.setAttribute("data-active", String(method === availableMethods[0]));
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `novalnet-dropin-${this.id}`;
      input.value = method;
      input.checked = method === availableMethods[0];
      this.radios.set(method, input);
      this.methodLabels.set(method, label);

      const logo = document.createElement("img");
      logo.className = styles.methodLogo;
      logo.src = method === "creditcard"
        ? DROPIN_PAYMENT_LOGOS.visa
        : method === "ach" ? ACH_BANK_ICON : DROPIN_PAYMENT_LOGOS[method] ?? ACH_BANK_ICON;
      logo.alt = ""; // The adjacent payment label provides the accessible name.
      logo.setAttribute("aria-hidden", "true");

      const text = document.createElement("span");
      text.className = styles.methodText;
      text.textContent = DROPIN_LABELS[method]?.[this.locale] || method;
      label.append(input, logo, text);
      methodList.appendChild(label);

      const panel = document.createElement("div");
      panel.className = styles.panel;
      panel.id = `novalnet-dropin-${this.id}-${method}`;
      panel.hidden = true;
      if (method === "creditcard") {
        // Show supported card brand artwork without changing hosted card fields.
        const cardBrands = document.createElement("div");
        cardBrands.className = styles.cardBrands;
        cardBrands.setAttribute("aria-label", this.locale === "de" ? "Kartenmarken" : "Card brands");
        for (const brand of ["visa", "mastercard", "amex"]) {
          const brandLogo = document.createElement("img");
          brandLogo.src = DROPIN_PAYMENT_LOGOS[brand];
          brandLogo.alt = brand === "amex" ? "American Express" : brand === "visa" ? "Visa" : "Mastercard";
          brandLogo.className = styles.cardBrandLogo;
          cardBrands.appendChild(brandLogo);
        }
        panel.appendChild(cardBrands);
      }
      root.appendChild(panel);
      this.panels.set(method, panel);

      input.addEventListener("change", () => {
        if (this.submitting || this.switching) {
          input.checked = false;
          if (this.selected) this.radios.get(this.selected)!.checked = true;
          return;
        }
        if (input.checked) void this.activate(method).catch((error) => {
          logFailure("switch-method", method, error);
          this.showError();
          input.checked = false;
          if (this.selected) this.radios.get(this.selected)!.checked = true;
        });
      });
    }

    // Drop-in owns its regular Pay button, irrespective of the host's
    // showPayButton flag, because dropinHasSubmit=false. Native wallet buttons
    // come from the Novalnet SDK and are shown instead when selected.
    const payButton = document.createElement("button");
    payButton.type = "button";
    payButton.className = styles.payButton;
    payButton.textContent = this.locale === "de" ? "Bezahlen" : "Pay";
    payButton.addEventListener("click", () => {
      void this.submit().catch((error) => {
        logFailure("pay-button", this.selected, error);
        this.showError();
      });
    });
    this.payButton = payButton;
    root.appendChild(payButton);

    const errorElement = document.createElement("p");
    errorElement.className = styles.error;
    errorElement.setAttribute("role", "alert");
    errorElement.hidden = true;
    root.appendChild(errorElement);
    this.errorElement = errorElement;

    let stage = "mount-initial-method";
    try {
      await this.activate(availableMethods[0]);
      stage = "notify-checkout-ready";
      novalnetDebug("dropin.ready.callback.start", { dropinId: this.id, selected: availableMethods[0] });
      await this.config.onDropinReady?.();
      novalnetDebug("dropin.ready.callback.complete", { dropinId: this.id });
    } catch (error) {
      novalnetDebugError("dropin.mount.failed", error, { dropinId: this.id, stage });
      logFailure(stage, availableMethods[0], error);
      await this.remove();
      throw error;
    }
  }

  private showError(): void {
    if (!this.errorElement) return;
    this.errorElement.textContent = this.locale === "de"
      ? "Die Zahlung konnte nicht gestartet werden. Bitte versuchen Sie es erneut."
      : "Unable to start payment. Please try again.";
    this.errorElement.hidden = false;
  }

  private async activate(method: string): Promise<void> {
    novalnetDebug("dropin.activate.start", { dropinId: this.id, method, selectedBefore: this.selected });
    if (!this.panels.has(method)) throw new Error(`Unsupported Drop-in method: ${method}`);
    if (this.switching || this.submitting) throw new Error("Payment method is busy");
    this.switching = true;
    for (const radio of this.radios.values()) radio.disabled = true;
    try {
      if (!this.components.has(method)) {
        const panel = this.panels.get(method)!;
        const pending = (async () => {
          const component = this.prepared.get(method) ??
            (await this.createBuilder(method)).build({
              showPayButton: false,
              // Only the embedded card requests strict SDK readiness checks.
              strictInitialization: method === "creditcard",
              ...(isWallet(method) ? { onPayButtonClick: this.config.onPayButtonClick } : {}),
            });
          novalnetDebug("dropin.component.mount.start", { dropinId: this.id, method });
          await Promise.resolve(component.mount(`#${panel.id}`));
          novalnetDebug("dropin.component.mount.complete", { dropinId: this.id, method });
          this.components.set(method, component);
          this.prepared.delete(method);
        })();
        this.mounting = pending;
        await pending;
      }
      this.selected = method;
      for (const [name, panel] of this.panels) panel.hidden = name !== method;
      for (const [name, radio] of this.radios) radio.checked = name === method;
      for (const [name, label] of this.methodLabels) label.setAttribute("data-active", String(name === method));
      if (this.payButton) this.payButton.hidden = isWallet(method);
      if (this.errorElement) this.errorElement.hidden = true;
      novalnetDebug("dropin.activate.complete", { dropinId: this.id, method });
    } catch (error) {
      novalnetDebugError("dropin.activate.failed", error, { dropinId: this.id, method });
      throw error;
    } finally {
      this.switching = false;
      for (const radio of this.radios.values()) radio.disabled = this.submitting;
    }
  }

  async submit(): Promise<void> {
    novalnetDebug("dropin.submit.start", { dropinId: this.id, selected: this.selected, submitting: this.submitting, switching: this.switching });
    if (this.submitting) return;
    if (this.switching) throw new Error("Payment method is still loading");
    if (!this.selected) throw new Error("No Novalnet payment method selected");
    // Fail explicitly rather than silently resolving a generic Checkout submit.
    if (isWallet(this.selected)) {
      throw new Error("Use the Google Pay or Apple Pay button to authorize this payment");
    }
    this.submitting = true;
    const method = this.selected;
    for (const radio of this.radios.values()) radio.disabled = true;
    if (this.payButton) this.payButton.disabled = true;
    try {
      await this.mounting;
      const component = this.components.get(method);
      if (!component) throw new Error("Payment component not ready");
      novalnetDebug("dropin.submit.host-validation", { dropinId: this.id, method });
      await this.config.onPayButtonClick?.();
      novalnetDebug("dropin.submit.component", { dropinId: this.id, method });
      await Promise.resolve(component.submit());
      novalnetDebug("dropin.submit.complete", { dropinId: this.id, method });
    } catch (error) {
      logFailure("submit", method, error);
      this.showError();
      throw error;
    } finally {
      this.submitting = false;
      for (const radio of this.radios.values()) radio.disabled = false;
      if (this.payButton) this.payButton.disabled = false;
    }
  }

  async remove(): Promise<void> {
    novalnetDebug("dropin.remove", { dropinId: this.id, selected: this.selected, mountedComponents: this.components.size });
    for (const component of [...this.components.values(), ...this.prepared.values()]) {
      try { await component.remove?.(); }
      catch (error) { logFailure("remove-component", this.selected, error); }
    }
    this.root?.remove();
    this.root = undefined;
    this.payButton = undefined;
    this.errorElement = undefined;
    this.panels.clear();
    this.radios.clear();
    this.methodLabels.clear();
    this.components.clear();
    this.prepared.clear();
    this.selected = undefined;
    this.mounting = undefined;
    this.switching = false;
    this.submitting = false;
  }
}
