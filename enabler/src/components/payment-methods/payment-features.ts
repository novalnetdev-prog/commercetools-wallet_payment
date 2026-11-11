import featureStyles from "../../style/paymentFeatures.module.scss";

type Features = {
  business: boolean;
  oneClick: boolean;
  savedPayments: Array<{ id: string; label: string }>;
};
type FeatureOptions = {
  container: Element;
  processorUrl: string;
  sessionId: string;
  type: string;
  locale: "en" | "de";
  fields: string[];
  dob?: string;
  onSelectionChange?: (saved: boolean) => void;
};
const text = {
  en: {
    save: "Save for future purchase",
    card: "Add new card details",
    account: "Add new account details",
    accountNumber: "Account Number",
    delete: "Delete saved payment",
    deleteError: "Unable to delete saved payment. Please try again.",
  },
  de: {
    save: "Speichern für zukünftige Einkäufe",
    card: "Neue Kreditkarte hinzufügen",
    account: "Neue Kontodaten hinzufügen",
    accountNumber: "Kontonummer",
    delete: "Gespeicherte Zahlungsdaten löschen",
    deleteError: "Die gespeicherten Zahlungsdaten konnten nicht gelöscht werden. Bitte versuchen Sie es erneut.",
  },
};
type NativeRadioClasses = { outer: string; inner: string; radio: string; text: string };
type RadioParts = {
  row: HTMLDivElement;
  outer: HTMLDivElement;
  inner: HTMLDivElement;
  input: HTMLInputElement;
  text: HTMLDivElement;
};

export class PaymentFeatures {
  private radios?: HTMLFieldSetElement;
  private nativeRadioObserver?: MutationObserver;
  private radioParts: RadioParts[] = [];
  private checkbox?: HTMLInputElement;
  private newFields: Array<{ element: HTMLElement; display: string }> = [];
  private saveLabel?: HTMLLabelElement;
  private deleteError?: HTMLElement;
  public business = false;
  private businessOptions?: FeatureOptions;
  private businessRequest?: Promise<void>;
  private businessObserver?: IntersectionObserver;
  private businessListener?: () => void;
  private dobState?: {
    input: HTMLInputElement;
    field: HTMLElement | null;
    display: string;
    disabled: boolean;
    required: boolean;
  };
  get savedPaymentId(): string | undefined {
    return (
      this.radios?.querySelector<HTMLInputElement>("input:checked")?.value ||
      undefined
    );
  }
  get paymentFields(): { savedPaymentId?: string; savePayment?: boolean } {
    return this.savedPaymentId
      ? { savedPaymentId: this.savedPaymentId }
      : this.checkbox?.checked
        ? { savePayment: true }
        : {};
  }
  private async loadFeatures(options: FeatureOptions): Promise<Features> {
    const response = await fetch(
      `${options.processorUrl}/paymentFeatures?paymentMethod=${encodeURIComponent(options.type)}&lang=${encodeURIComponent(options.locale)}`,
      { headers: { "X-Session-Id": options.sessionId }, cache: "no-store" },
    );
    if (!response.ok) throw new Error("Unable to load payment settings.");
    return response.json();
  }
  private applyBusiness(business: boolean): void {
    this.business = business;
    const dob = this.dobState;
    if (!dob) return;
    if (dob.field) dob.field.style.display = business ? "none" : dob.display;
    dob.input.disabled = business ? true : dob.disabled;
    dob.input.required = business ? false : dob.required;
  }
  public async refreshBusiness(): Promise<void> {
    const options = this.businessOptions;
    if (!options?.dob) return;
    if (this.businessRequest) return this.businessRequest;
    const request = this.loadFeatures(options).then((data) => {
      if (this.businessOptions === options) this.applyBusiness(data.business === true);
    });
    this.businessRequest = request;
    try {
      await request;
    } finally {
      if (this.businessRequest === request) this.businessRequest = undefined;
    }
  }
  private watchBusiness(options: FeatureOptions): void {
    if (!options.dob) return;
    const refresh = () => { void this.refreshBusiness().catch(() => {}); };
    this.businessListener = refresh;
    options.container.addEventListener("focusin", refresh);
    options.container.addEventListener("pointerenter", refresh);
    if (typeof IntersectionObserver !== "undefined") {
      const observer = new IntersectionObserver((entries) => {
        if (!options.container.isConnected) {
          observer.disconnect();
          return;
        }
        if (entries.some((entry) => entry.isIntersecting)) refresh();
      });
      observer.observe(options.container);
      this.businessObserver = observer;
    }
  }
  async mount(options: FeatureOptions): Promise<void> {
    this.businessObserver?.disconnect();
    this.nativeRadioObserver?.disconnect();
    this.nativeRadioObserver = undefined;
    this.radioParts = [];
    if (this.businessOptions && this.businessListener) {
      this.businessOptions.container.removeEventListener("focusin", this.businessListener);
      this.businessOptions.container.removeEventListener("pointerenter", this.businessListener);
    }

    for (const field of this.newFields) field.element.style.display = field.display;
    this.radios?.remove();
    this.saveLabel?.remove();
    this.deleteError?.remove();
    this.radios = undefined;
    this.saveLabel = undefined;
    this.checkbox = undefined;
    this.deleteError = undefined;
    this.newFields = [];
    this.businessOptions = options;
    this.businessRequest = undefined;
    const input = options.dob
      ? options.container.querySelector<HTMLInputElement>(options.dob) : null;
    this.dobState = input ? this.dobState?.input === input ? this.dobState : {
      input, field: input.parentElement, display: input.parentElement?.style.display ?? "",
      disabled: input.disabled, required: input.required,
    } : undefined;
    const data = await this.loadFeatures(options);
    if (this.businessOptions !== options) return;
    this.applyBusiness(data.business === true);
    this.watchBusiness(options);
    if (!data.oneClick) return;
    const dictionary = text[options.locale];
    this.newFields = options.fields
      .map((selector) => options.container.querySelector<HTMLElement>(selector))
      .filter((element): element is HTMLElement => Boolean(element))
      .map((element) => ({ element, display: element.style.display }));
    const payments = Array.isArray(data.savedPayments)
      ? data.savedPayments.slice(0, 3)
      : [];
    if (payments.length) {
      this.radios = this.renderSavedPayments(options, payments, dictionary);
      options.container.prepend(this.radios);
      this.watchNativeRadio(options);
    }
    this.saveLabel = document.createElement("label");
    this.saveLabel.className = featureStyles.consent;
    this.checkbox = document.createElement("input");
    this.checkbox.type = "checkbox";
    this.checkbox.checked = false;
    this.saveLabel.append(
      this.checkbox,
      document.createTextNode(` ${dictionary.save}`),
    );
    const last = this.newFields[this.newFields.length - 1]?.element;
    if (last) last.after(this.saveLabel);
    else options.container.appendChild(this.saveLabel);
    this.toggle();
  }
  
  private readNativeRadioClasses(): NativeRadioClasses | undefined {
    if (typeof document.querySelector !== "function") return undefined;
    const nativeRadio = document.querySelector<HTMLInputElement>(
      'input[type="radio"][name="payment-selector-list"]',
    );
    const inner = nativeRadio?.parentElement;
    const outer = inner?.parentElement;
    if (!nativeRadio?.className || !inner?.className || !outer) return undefined;
    const text = inner.querySelector<HTMLElement>(":scope > span > div");
    return {
      outer: outer.className,
      inner: inner.className,
      radio: nativeRadio.className,
      text: text?.className ?? "",
    };
  }


  private applyNativeRadioClasses(): boolean {
    const classes = this.readNativeRadioClasses();
    if (!classes || !this.radioParts.length) return false;
    for (const part of this.radioParts) {
      part.row.className = `${featureStyles.row} ${featureStyles.native}`;
      part.outer.className = `${featureStyles.outer} ${classes.outer}`;
      part.inner.className = `${featureStyles.inner} ${classes.inner}`;
      part.input.className = `${featureStyles.radio} ${classes.radio}`;
      part.text.className = `${featureStyles.text} ${classes.text}`;
    }
    return true;
  }

  private watchNativeRadio(options: FeatureOptions): void {
    this.nativeRadioObserver?.disconnect();
    this.nativeRadioObserver = undefined;
    if (this.applyNativeRadioClasses()) return;
    if (typeof MutationObserver === "undefined" || !document.documentElement) return;
    const observer = new MutationObserver(() => {
      if (this.businessOptions !== options || this.radios?.isConnected === false) {
        observer.disconnect();
        if (this.nativeRadioObserver === observer) this.nativeRadioObserver = undefined;
        return;
      }
      if (this.applyNativeRadioClasses()) {
        observer.disconnect();
        if (this.nativeRadioObserver === observer) this.nativeRadioObserver = undefined;
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    this.nativeRadioObserver = observer;

    if (this.applyNativeRadioClasses()) {
      observer.disconnect();
      this.nativeRadioObserver = undefined;
    }
  }

  private createRadioLabel(
    row: HTMLDivElement,
    options: FeatureOptions,
    value: string,
    displayName: string,
    checked: boolean,
  ): HTMLLabelElement {
    const label = document.createElement("label");
    label.className = featureStyles.label;

    const outer = document.createElement("div");
    outer.className = featureStyles.outer;
    const inner = document.createElement("div");
    inner.className = featureStyles.inner;
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.className = featureStyles.radio;
    radio.name = `nn_saved_${options.type}`;
    radio.value = value;
    radio.checked = checked;
    radio.addEventListener("change", () => this.toggle());

    const content = document.createElement("span");
    const textContainer = document.createElement("div");
    textContainer.className = featureStyles.text;
    const name = document.createElement("span");
    name.className = featureStyles.name;
    name.textContent = displayName; 
    textContainer.appendChild(name);
    content.appendChild(textContainer);
    inner.append(radio, content);
    outer.appendChild(inner);
    label.appendChild(outer);
    this.radioParts.push({ row, outer, inner, input: radio, text: textContainer });
    return label;
  }

  private renderSavedPayments(
    options: FeatureOptions,
    payments: Array<{ id: string; label: string }>,
    dictionary: typeof text["en"] | typeof text["de"],
    selectedId?: string,
  ): HTMLFieldSetElement {
    const fieldset = document.createElement("fieldset");
    fieldset.className = featureStyles.options;
    fieldset.setAttribute(
      "aria-label",
      options.locale === "de" ? "Gespeicherte Zahlungsarten" : "Saved payment methods",
    );
    this.radioParts = [];

    payments.forEach((payment, index) => {
      const row = document.createElement("div");
      row.className = featureStyles.row;
      const label = this.createRadioLabel(
        row,
        options,
        payment.id,
        payment.label,
        selectedId !== undefined ? payment.id === selectedId : index === 0,
      );

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = featureStyles.delete;
      remove.title = dictionary.delete;
      remove.setAttribute("aria-label", `${dictionary.delete}: ${payment.label}`);
      remove.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>';

      remove.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (remove.disabled) return;
        remove.disabled = true;
        this.deleteError?.remove();
        this.deleteError = undefined;
        const selectedBeforeDelete =
          this.radios?.querySelector<HTMLInputElement>("input:checked")?.value;

        try {
          const result = await fetch(`${options.processorUrl}/deleteSavedPayment`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Session-Id": options.sessionId,
            },
            body: JSON.stringify({
              paymentMethod: options.type,
              savedPaymentId: payment.id,
            }),
          });
          if (!result.ok) throw new Error("Saved payment deletion failed.");

          const refreshed = await this.loadFeatures(options);
          if (this.businessOptions !== options) return;
          const refreshedPayments = Array.isArray(refreshed.savedPayments)
            ? refreshed.savedPayments.slice(0, 3)
            : [];

          if (refreshedPayments.length) {
            const nextSelectedId =
              selectedBeforeDelete === ""
                ? ""
                : selectedBeforeDelete && selectedBeforeDelete !== payment.id &&
                    refreshedPayments.some((item) => item.id === selectedBeforeDelete)
                  ? selectedBeforeDelete
                  : refreshedPayments[0].id;
            const replacement = this.renderSavedPayments(
              options,
              refreshedPayments,
              dictionary,
              nextSelectedId,
            );
            this.radios?.replaceWith(replacement);
            this.radios = replacement;
            this.applyNativeRadioClasses();
          } else {
            this.radios?.remove();
            this.radios = undefined;
            this.radioParts = [];
            this.nativeRadioObserver?.disconnect();
            this.nativeRadioObserver = undefined;
          }
          this.toggle();
        } catch {
          remove.disabled = false;
          this.deleteError = document.createElement("p");
          this.deleteError.setAttribute("role", "alert");
          this.deleteError.textContent = dictionary.deleteError;
          this.radios?.appendChild(this.deleteError);
        }
      });

      row.append(label, remove);
      fieldset.appendChild(row);
    });


    const newRow = document.createElement("div");
    newRow.className = featureStyles.row;
    const newLabel = this.createRadioLabel(
      newRow,
      options,
      "",
      options.type === "CREDITCARD" ? dictionary.card : dictionary.account,
      selectedId === "",
    );
    newRow.appendChild(newLabel);
    fieldset.appendChild(newRow);
    return fieldset;
  }

  private toggle(): void {
    const saved = Boolean(this.savedPaymentId);
    for (const field of this.newFields)
      field.element.style.display = saved ? "none" : field.display;
    if (this.saveLabel) this.saveLabel.style.display = saved ? "none" : "block";
    if (saved && this.checkbox) this.checkbox.checked = false;
    this.businessOptions?.onSelectionChange?.(saved);
  }
}
