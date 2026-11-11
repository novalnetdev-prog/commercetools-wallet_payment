import type {
  DropinOptions,
  DropinComponent,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
} from "../../../payment-enabler/payment-enabler";
import styles from "../../../style/dropin.module.scss";

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

let nextDropinId = 0;

export class NovalnetDropinBuilder implements PaymentDropinBuilder {
  readonly dropinHasSubmit = true;

  constructor(
    private readonly methods: string[],
    private readonly createBuilder: (type: string) => Promise<PaymentComponentBuilder>,
    private readonly locale: "en" | "de",
  ) {}

  build(config: DropinOptions): DropinComponent {
    return new NovalnetDropin(this.methods, this.createBuilder, this.locale, config);
  }
}

/**
 * An opt-in UI wrapper around the existing component API. Only one method is
 * ever submitted. No new backend payment, token, or refund flow is introduced.
 */
export class NovalnetDropin implements DropinComponent {
  private root?: HTMLElement;
  private payButton?: HTMLButtonElement;
  private selected?: string;
  private components = new Map<string, PaymentComponent>();
  private panels = new Map<string, HTMLElement>();
  private radios = new Map<string, HTMLInputElement>();
  private mounting?: Promise<void>;
  private submitting = false;
  private id = ++nextDropinId;

  constructor(
    private readonly methods: string[],
    private readonly createBuilder: (type: string) => Promise<PaymentComponentBuilder>,
    private readonly locale: "en" | "de",
    private readonly config: DropinOptions,
  ) {}

  async mount(selector: string): Promise<void> {
    if (this.root) throw new Error("Novalnet Drop-in is already mounted.");
    const container = document.querySelector(selector);
    if (!container) throw new Error(`Drop-in container not found: ${selector}`);
    if (!this.methods.length) throw new Error("No Novalnet Drop-in methods configured.");

    const root = document.createElement("div");
    root.className = styles.dropin;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", this.locale === "de" ? "Zahlungsart" : "Payment method");
    this.root = root;
    container.appendChild(root);

    for (const method of this.methods) {
      const label = document.createElement("label");
      label.className = styles.method;
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `novalnet-dropin-${this.id}`;
      input.value = method;
      input.checked = method === this.methods[0];
      this.radios.set(method, input);
      const text = document.createElement("span");
      text.textContent = DROPIN_LABELS[method]?.[this.locale] || method;
      label.append(input, text);
      root.appendChild(label);
      const panel = document.createElement("div");
      panel.className = styles.panel;
      panel.id = `novalnet-dropin-${this.id}-${method}`;
      panel.hidden = true;
      root.appendChild(panel);
      this.panels.set(method, panel);
      input.addEventListener("change", () => {
        if (this.submitting) {
          input.checked = false;
          if (this.selected) this.radios.get(this.selected)!.checked = true;
          return;
        }
        if (input.checked) void this.activate(method).catch((err) => {
          console.error("[Novalnet Drop-in] Failed to activate method", err);
        });
      });
    }

    if (this.config.showPayButton) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = styles.payButton;
      this.payButton = button;
      button.textContent = this.locale === "de" ? "Bezahlen" : "Pay";
      button.addEventListener("click", () => {
        void this.submit().catch((err) => {
          console.error("[Novalnet Drop-in] Submission failed", err);
        });
      });
      root.appendChild(button);
    }

    try {
      await this.activate(this.methods[0]);
      await this.config.onDropinReady?.();
    } catch (error) {
      await this.remove();
      throw error;
    }
  }

  private async activate(method: string): Promise<void> {
    if (!this.panels.has(method)) throw new Error("Unsupported Drop-in method");
    this.selected = method;
    // A wallet's native button must initiate its own authentication sheet.
    if (this.payButton) this.payButton.hidden = method === "googlepay" || method === "applepay";
    for (const [name, panel] of this.panels) panel.hidden = name !== method;

    if (this.components.has(method)) {
      this.mounting = undefined;
      return;
    }
    const panel = this.panels.get(method)!;
    const mount = async () => {
      const builder = await this.createBuilder(method);
      const component = builder.build({
        showPayButton: false,
        // Native wallet click starts the checkout callback; the Drop-in Pay button
        // remains dedicated to regular methods.
        ...(method === "googlepay" || method === "applepay"
          ? { onPayButtonClick: this.config.onPayButtonClick } : {}),
      });
      // Existing components use #id selectors (and CSS.escape), not DOM nodes.
      await Promise.resolve(component.mount(`#${panel.id}`));
      this.components.set(method, component);
    };
    const pending = mount();
    this.mounting = pending;
    await pending;
  }

  async submit(): Promise<void> {
    if (this.submitting) return;
    if (!this.selected) throw new Error("No Novalnet payment method selected");
    // Never treat a generic checkout submit as wallet authorization.
    if (this.selected === "googlepay" || this.selected === "applepay") return;
    this.submitting = true;
    const method = this.selected;
    for (const radio of this.radios.values()) radio.disabled = true;
    try {
      await this.mounting;
      const component = this.components.get(method);
      if (!component) throw new Error("Payment component not ready");
      await this.config.onPayButtonClick?.();
      await Promise.resolve(component.submit());
    } finally {
      this.submitting = false;
      for (const radio of this.radios.values()) radio.disabled = false;
    }
  }

  async remove(): Promise<void> {
    this.root?.remove();
    this.root = undefined;
    this.payButton = undefined;
    this.panels.clear();
    this.radios.clear();
    this.components.clear();
    this.selected = undefined;
    this.mounting = undefined;
  }
}
