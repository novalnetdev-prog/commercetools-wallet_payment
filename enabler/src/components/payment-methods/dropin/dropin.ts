import type {
  DropinOptions,
  DropinComponent,
  PaymentComponent,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
} from "../../../payment-enabler/payment-enabler";
import styles from "../../../style/dropin.module.scss";
import { appendNovalnetLogo } from "./dropin-logos";
import { novalnetDebug, novalnetDebugError } from "../../../utils/novalnet-debug";

export const DROPIN_LABELS: Record<string, { en: string; de: string }> = {
  creditcard: { en: "Card", de: "Karte" },
  sepa: { en: "SEPA", de: "SEPA" },
  ach: { en: "ACH", de: "ACH" },
  invoice: { en: "Invoice", de: "Rechnung" },
  prepayment: { en: "Prepayment", de: "Vorkasse" },
  paypal: { en: "PayPal", de: "PayPal" },
  googlepay: { en: "Google Pay", de: "Google Pay" },
  applepay: { en: "Apple Pay", de: "Apple Pay" },
};

const isWallet = (method: string): boolean => method === "googlepay" || method === "applepay";
let nextDropinId = 0;

function logFailure(stage: string, method: string | undefined, error: unknown): void {
  // Do not log session IDs, payment tokens, addresses, cart data or PSP payloads.
  console.error("[Novalnet][Drop-in]", {
    stage,
    method,
    message: error instanceof Error ? error.message : "Payment component error",
    stack: error instanceof Error ? error.stack : undefined,
  });
}

export class NovalnetDropinBuilder implements PaymentDropinBuilder {
  /**
   * Match the Checkout-owned submit lifecycle used by Stripe's Payment Element.
   * Checkout invokes dropin.submit() for ordinary methods. Wallets must use
   * their own SDK-rendered buttons (a browser user gesture is required).
   */
  readonly dropinHasSubmit: boolean;

  constructor(
    private readonly methods: string[],
    private readonly createBuilder: (type: string) => Promise<PaymentComponentBuilder>,
    private readonly locale: "en" | "de",
  ) {
    this.dropinHasSubmit = this.methods.some((method) => !isWallet(method));
  }

  build(config: DropinOptions): DropinComponent {
    novalnetDebug("dropin.build", {
      methodCount: this.methods.length,
      methods: this.methods,
      hostShowsPayButton: config.showPayButton,
      dropinHasSubmit: this.dropinHasSubmit,
    });
    return new NovalnetDropin(this.methods, this.createBuilder, this.locale, config);
  }
}

/** A single Checkout Drop-in wrapping the existing Novalnet payment components. */
export class NovalnetDropin implements DropinComponent {
  private root?: HTMLElement;
  private errorElement?: HTMLElement;
  private selected?: string;
  private readonly components = new Map<string, PaymentComponent>();
  private readonly prepared = new Map<string, PaymentComponent>();
  private readonly panels = new Map<string, HTMLElement>();
  private readonly radios = new Map<string, HTMLInputElement>();
  private readonly methodLabels = new Map<string, HTMLLabelElement>();
  private regularMethods: string[] = [];
  private methodList?: HTMLElement;
  private overflowSelect?: HTMLSelectElement;
  private resizeObserver?: ResizeObserver;
  private mounting?: Promise<void>;
  private submitting = false;
  private switching = false;
  private disposed = false;
  private readonly id = ++nextDropinId;

  constructor(
    private readonly methods: string[],
    private readonly createBuilder: (type: string) => Promise<PaymentComponentBuilder>,
    private readonly locale: "en" | "de",
    private readonly config: DropinOptions,
  ) {}

  async mount(selector: string): Promise<void> {
    novalnetDebug("dropin.mount.start", { dropinId: this.id, methodCount: this.methods.length });
    if (this.root) throw new Error("Novalnet Drop-in is already mounted");
    if (this.disposed) throw new Error("Novalnet Drop-in has been removed");
    const container = document.querySelector(selector);
    if (!container) throw new Error(`Drop-in container not found: ${selector}`);
    if (!this.methods.length) throw new Error("No Novalnet Drop-in methods configured");

    // Probe wallets concurrently: a slow/unavailable native wallet must not
    // serialize Google Pay and Apple Pay initialization. Ordinary methods do
    // not need SDK availability probes.
    const availability = await Promise.all(this.methods.map(async (method) => {
      if (!isWallet(method)) return true;
      try {
        novalnetDebug("dropin.wallet.probe", { dropinId: this.id, method });
        const builder = await this.createBuilder(method);
        const component = builder.build({
          showPayButton: false,
          strictInitialization: true,
          onPayButtonClick: this.config.onPayButtonClick,
        });
        const available = Boolean(component.isAvailable && (await component.isAvailable()));
        novalnetDebug("dropin.wallet.probe.result", { dropinId: this.id, method, available });
        if (available) this.prepared.set(method, component);
        else await component.remove?.();
        return available;
      } catch (error) {
        logFailure("wallet-availability", method, error);
        return false;
      }
    }));
    if (this.disposed) throw new Error("Novalnet Drop-in was removed during initialization");
    const methods = this.methods.filter((_method, index) => availability[index]);
    novalnetDebug("dropin.mount.methods", { dropinId: this.id, availableMethods: methods });
    if (!methods.length) throw new Error("No configured Novalnet payment method is available on this device");
    const regularMethods = methods.filter((method) => !isWallet(method));
    const walletMethods = methods.filter(isWallet);

    const root = document.createElement("div");
    root.className = styles.dropin;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", this.locale === "de" ? "Zahlungsart" : "Payment method");
    this.root = root;
    container.appendChild(root);

    // Native wallet buttons are separate actions INSIDE the unified Drop-in.
    // Unlike Stripe's Payment Element, Novalnet SDK wallets cannot safely be
    // triggered by a generic Checkout submit() call.
    const walletHosts = new Map<string, HTMLElement>();
    let walletSection: HTMLElement | undefined;
    if (walletMethods.length) {
      const walletRow = document.createElement("div");
      walletRow.className = styles.walletRow;
      walletRow.setAttribute("role", "group");
      walletRow.setAttribute("aria-label", this.locale === "de" ? "Wallet-Zahlung" : "Wallet payment");
      const heading = document.createElement("p");
      heading.className = styles.walletHeading;
      heading.textContent = this.locale === "de" ? "Mit Wallet bezahlen" : "Pay with a wallet";
      walletRow.appendChild(heading);
      const walletActions = document.createElement("div");
      walletActions.className = styles.walletActions;
      for (const method of walletMethods) {
        const host = document.createElement("div");
        host.className = styles.walletAction;
        host.id = `novalnet-dropin-${this.id}-${method}`;
        walletActions.appendChild(host);
        walletHosts.set(method, host);
      }
      walletRow.appendChild(walletActions);
      walletSection = walletRow;
    }

    const methodList = document.createElement("div");
    methodList.className = styles.methodList;
    methodList.setAttribute("role", "radiogroup");
    methodList.setAttribute("aria-label", this.locale === "de" ? "Zahlungsart wählen" : "Choose payment method");
    if (regularMethods.length) root.appendChild(methodList);
    this.regularMethods = regularMethods;
    this.methodList = methodList;

    const panelHolder = document.createElement("div");
    panelHolder.className = styles.panelHolder;
    root.appendChild(panelHolder);
    // Keep the core payment selector as the primary Drop-in experience.
    // Wallet SDK buttons remain native, but are presented after standard methods.
    if (walletSection) {
      if (regularMethods.length) {
        const divider = document.createElement("p");
        divider.className = styles.divider;
        divider.textContent = this.locale === "de" ? "Oder schneller mit Wallet bezahlen" : "Or pay faster with a wallet";
        root.appendChild(divider);
      }
      root.appendChild(walletSection);
    }

    for (const method of regularMethods) {
      const label = document.createElement("label");
      label.className = styles.method;
      label.setAttribute("data-active", String(method === regularMethods[0]));
      const input = document.createElement("input");
      input.type = "radio";
      input.name = `novalnet-dropin-${this.id}`;
      input.value = method;
      input.checked = method === regularMethods[0];
      this.radios.set(method, input);
      this.methodLabels.set(method, label);

      const text = document.createElement("span");
      text.className = styles.methodText;
      text.textContent = DROPIN_LABELS[method]?.[this.locale] || method;
      appendNovalnetLogo(label, method, styles.methodLogo);
      label.append(input, text);
      methodList.appendChild(label);

      const panel = document.createElement("section");
      panel.className = styles.panel;
      panel.id = `novalnet-dropin-${this.id}-${method}`;
      panel.setAttribute("aria-label", DROPIN_LABELS[method]?.[this.locale] || method);
      panel.hidden = true;
      if (method === "creditcard") {
        // Show real Novalnet card brands only when their CDN assets exist.
        const cardBrands = document.createElement("div");
        cardBrands.className = styles.cardBrands;
        cardBrands.setAttribute("aria-label", this.locale === "de" ? "Akzeptierte Karten" : "Accepted cards");
        for (const brand of ["visa", "mastercard", "amex"]) {
          appendNovalnetLogo(
            cardBrands, brand, styles.cardBrandLogo,
            brand === "amex" ? "American Express" : brand === "visa" ? "Visa" : "Mastercard",
          );
        }
        panel.appendChild(cardBrands);
      }
      panelHolder.appendChild(panel);
      this.panels.set(method, panel);

      input.addEventListener("change", () => {
        if (this.disposed) return;
        if (this.submitting || this.switching) {
          input.checked = false;
          if (this.selected) this.radios.get(this.selected)!.checked = true;
          return;
        }
        if (input.checked) void this.activate(method).catch((error) => {
          logFailure("switch-method", method, error);
          this.showError();
        });
      });
    }

    if (regularMethods.length > 1) {
      // Like Stripe's tab selector, only a few methods are visible at once;
      // additional methods are accessible via a keyboard-friendly dropdown.
      const more = document.createElement("label");
      more.className = styles.moreMethods;
      more.setAttribute("title", this.locale === "de" ? "Weitere Zahlungsarten" : "More payment methods");
      const moreSelect = document.createElement("select");
      moreSelect.className = styles.moreSelect;
      moreSelect.setAttribute("aria-label", this.locale === "de" ? "Weitere Zahlungsarten" : "More payment methods");
      moreSelect.addEventListener("change", () => {
        const method = moreSelect.value;
        moreSelect.value = "";
        if (!method || this.switching || this.submitting || this.disposed) return;
        void this.activate(method).catch((error) => {
          logFailure("overflow-switch", method, error);
          this.showError();
        });
      });
      const chevron = document.createElement("span");
      chevron.className = styles.moreChevron;
      chevron.textContent = "⌄";
      chevron.setAttribute("aria-hidden", "true");
      more.append(moreSelect, chevron);
      methodList.appendChild(more);
      this.overflowSelect = moreSelect;
      this.updateVisibleTabs();
      if (typeof ResizeObserver !== "undefined") {
        this.resizeObserver = new ResizeObserver(() => this.updateVisibleTabs());
        this.resizeObserver.observe(root);
      }
    }

    const errorElement = document.createElement("p");
    errorElement.className = styles.error;
    errorElement.setAttribute("role", "alert");
    errorElement.hidden = true;
    root.appendChild(errorElement);
    this.errorElement = errorElement;

    let stage = "mount-wallets";
    try {
      let mountedWallets = 0;
      // Each wallet's button is rendered in a visible container by its SDK.
      // Do not hide or manufacture a click on a native wallet button.
      for (const method of walletMethods) {
        const host = walletHosts.get(method)!;
        try {
          const component = this.prepared.get(method)!;
          novalnetDebug("dropin.wallet.mount.start", { dropinId: this.id, method });
          await Promise.resolve(component.mount(`#${host.id}`));
          if (this.disposed) throw new Error("Drop-in removed during wallet mounting");
          this.components.set(method, component);
          this.prepared.delete(method);
          mountedWallets++;
          novalnetDebug("dropin.wallet.mount.complete", { dropinId: this.id, method });
        } catch (error) {
          logFailure("wallet-mount", method, error);
          try { await this.prepared.get(method)?.remove?.(); } catch { /* keep wallet failure isolated */ }
          this.prepared.delete(method);
          host.remove();
        }
      }
      if (regularMethods.length) {
        stage = "mount-initial-method";
        await this.activate(regularMethods[0]);
      } else if (!mountedWallets) {
        throw new Error("No Novalnet wallet could be mounted");
      }
      stage = "notify-checkout-ready";
      novalnetDebug("dropin.ready.callback.start", { dropinId: this.id, selected: this.selected, walletCount: mountedWallets });
      await this.config.onDropinReady?.();
      novalnetDebug("dropin.ready.callback.complete", { dropinId: this.id });
    } catch (error) {
      novalnetDebugError("dropin.mount.failed", error, { dropinId: this.id, stage });
      logFailure(stage, regularMethods[0], error);
      await this.remove();
      throw error;
    }
  }

  /** Keep the selected payment tab visible, even when chosen from More. */
  private updateVisibleTabs(): void {
    if (!this.methodList || !this.regularMethods.length) return;
    const width = this.root?.getBoundingClientRect?.().width || this.root?.clientWidth || 900;
    const maxTabs = width < 430 ? 2 : width < 680 ? 3 : 4;
    const hasMore = this.regularMethods.length > maxTabs;
    const count = hasMore ? maxTabs : this.regularMethods.length;
    const selected = this.selected;
    const visible = this.regularMethods.slice(0, count);
    if (hasMore && selected && !visible.includes(selected)) visible[count - 1] = selected;
    for (const method of this.regularMethods) {
      const label = this.methodLabels.get(method);
      const radio = this.radios.get(method);
      if (label) label.hidden = !visible.includes(method);
      if (radio) radio.disabled = !visible.includes(method) || this.switching || this.submitting;
    }
    if (this.overflowSelect) {
      const more = this.overflowSelect.parentElement;
      if (more) more.hidden = !hasMore;
      this.overflowSelect.disabled = !hasMore || this.switching || this.submitting;
      // Only static method names from the processor's allow-list enter this menu.
      this.overflowSelect.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = this.locale === "de" ? "Weitere" : "More";
      this.overflowSelect.appendChild(placeholder);
      for (const method of this.regularMethods) {
        if (visible.includes(method)) continue;
        const option = document.createElement("option");
        option.value = method;
        option.textContent = DROPIN_LABELS[method]?.[this.locale] || method;
        this.overflowSelect.appendChild(option);
      }
      this.overflowSelect.value = "";
    }
    // All available Checkout width is used (no fixed 560px form width).
    this.methodList.style?.setProperty?.(
      "grid-template-columns", `repeat(${count}, minmax(0, 1fr))${hasMore ? " 50px" : ""}`,
    );
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
    if (this.disposed) throw new Error("Novalnet Drop-in has been removed");
    if (!this.panels.has(method)) throw new Error(`Unsupported Drop-in method: ${method}`);
    if (this.switching || this.submitting) throw new Error("Payment method is busy");
    this.switching = true;
    const previous = this.selected;
    for (const radio of this.radios.values()) radio.disabled = true;
    try {
      // IMPORTANT: SDK-hosted card iframes and native wallet buttons must mount
      // inside a VISIBLE container. Mounting in hidden panels returns zero
      // dimensions and can produce blank fields or an incorrect layout.
      for (const [name, panel] of this.panels) panel.hidden = name !== method;
      if (!this.components.has(method)) {
        const panel = this.panels.get(method)!;
        const pending = (async () => {
          const component = this.prepared.get(method) ??
            (await this.createBuilder(method)).build({
              showPayButton: false,
              strictInitialization: method === "creditcard",
              ...(isWallet(method) ? { onPayButtonClick: this.config.onPayButtonClick } : {}),
            });
          novalnetDebug("dropin.component.mount.start", { dropinId: this.id, method });
          try {
            await Promise.resolve(component.mount(`#${panel.id}`));
            if (this.disposed) throw new Error("Novalnet Drop-in removed while mounting component");
            this.components.set(method, component);
            this.prepared.delete(method);
          } catch (error) {
            try { await component.remove?.(); } catch { /* preserve the original mount error */ }
            throw error;
          }
          novalnetDebug("dropin.component.mount.complete", { dropinId: this.id, method });
        })();
        this.mounting = pending;
        await pending;
      }
      this.selected = method;
      for (const [name, radio] of this.radios) radio.checked = name === method;
      for (const [name, label] of this.methodLabels) label.setAttribute("data-active", String(name === method));
      if (this.errorElement) this.errorElement.hidden = true;
      this.updateVisibleTabs();
      novalnetDebug("dropin.activate.complete", { dropinId: this.id, method });
    } catch (error) {
      for (const [name, panel] of this.panels) panel.hidden = name !== previous;
      for (const [name, radio] of this.radios) radio.checked = name === previous;
      for (const [name, label] of this.methodLabels) label.setAttribute("data-active", String(name === previous));
      this.updateVisibleTabs();
      novalnetDebugError("dropin.activate.failed", error, { dropinId: this.id, method });
      throw error;
    } finally {
      this.switching = false;
      this.updateVisibleTabs();
    }
  }

  async submit(): Promise<void> {
    novalnetDebug("dropin.submit.start", { dropinId: this.id, selected: this.selected });
    if (this.disposed) throw new Error("Novalnet Drop-in has been removed");
    if (this.submitting) return;
    if (this.switching) throw new Error("Payment method is still loading");
    if (!this.selected) throw new Error("Use the Google Pay or Apple Pay button to authorize this payment");
    this.submitting = true;
    const method = this.selected;
    for (const radio of this.radios.values()) radio.disabled = true;
    try {
      await this.mounting;
      const component = this.components.get(method);
      if (!component) throw new Error("Payment component not ready");
      await this.config.onPayButtonClick?.();
      await Promise.resolve(component.submit());
      novalnetDebug("dropin.submit.complete", { dropinId: this.id, method });
    } catch (error) {
      logFailure("submit", method, error);
      this.showError();
      throw error;
    } finally {
      this.submitting = false;
      this.updateVisibleTabs();
    }
  }

  async remove(): Promise<void> {
    novalnetDebug("dropin.remove", { dropinId: this.id, selected: this.selected, mountedComponents: this.components.size });
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.resizeObserver = undefined;
    for (const component of new Set([...this.components.values(), ...this.prepared.values()])) {
      try { await component.remove?.(); }
      catch (error) { logFailure("remove-component", this.selected, error); }
    }
    this.root?.remove();
    this.root = undefined;
    this.errorElement = undefined;
    this.panels.clear();
    this.radios.clear();
    this.methodLabels.clear();
    this.regularMethods = [];
    this.methodList = undefined;
    this.overflowSelect = undefined;
    this.components.clear();
    this.prepared.clear();
    this.selected = undefined;
    this.mounting = undefined;
    this.switching = false;
    this.submitting = false;
  }
}
