import { BaseComponent } from "../../base";
import type { BaseOptions } from "../../../payment-enabler/novalnet-payment-enabler";
import {
  ComponentOptions, PaymentComponent, PaymentComponentBuilder,
  PaymentMethod,
} from "../../../payment-enabler/payment-enabler";
import { PaymentOutcome } from "../../../dtos/novalnet-payment.dto";
import type { PaymentRequestSchemaDTO } from "../../../dtos/novalnet-payment.dto";
import styles from "../../../style/wallet.module.scss";

type WalletType = "GOOGLEPAY" | "APPLEPAY";
type WalletConfig = {
  clientKey: string;
  merchantName: string;
  countryCode: string;
  partnerId?: string;
  amount: number;
  currency: string;
  environment: "SANDBOX" | "PRODUCTION";
};
type NovalnetWalletInstance = {
  setPaymentIntent(input: unknown): void;
  isPaymentMethodAvailable(callback: (available: boolean) => void): void;
  addPaymentButton(selector: string): void;
};

declare global {
  interface Window {
    NovalnetPayment?: () => { createPaymentObject(): NovalnetWalletInstance };
  }
}

const sdkUrl = "https://cdn.novalnet.de/js/v3/payment.js";
let nextWalletId = 0;
let walletScriptPromise: Promise<void> | undefined;

function loadWalletSdk(): Promise<void> {
  if (window.NovalnetPayment) return Promise.resolve();
  if (walletScriptPromise) return walletScriptPromise;
  walletScriptPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[src="${sdkUrl}"]`) as HTMLScriptElement | null;
    const script = existing ?? document.createElement("script");
    const onLoad = () => window.NovalnetPayment ? resolve() : reject(new Error("Novalnet wallet SDK unavailable"));
    const onError = () => reject(new Error("Novalnet wallet SDK failed to load"));
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!existing) {
      script.src = sdkUrl;
      script.async = true;
      document.head.appendChild(script);
    }
  }).catch((err) => {
    walletScriptPromise = undefined; // Allow retry after a failed script load.
    throw err;
  });
  return walletScriptPromise;
}

export class GooglePayBuilder implements PaymentComponentBuilder {
  readonly componentHasSubmit = false;
  constructor(private readonly options: BaseOptions) {}
  build(config: ComponentOptions): PaymentComponent {
    return new NovalnetWallet("GOOGLEPAY", this.options, config);
  }
}

export class ApplePayBuilder implements PaymentComponentBuilder {
  readonly componentHasSubmit = false;
  constructor(private readonly options: BaseOptions) {}
  build(config: ComponentOptions): PaymentComponent {
    return new NovalnetWallet("APPLEPAY", this.options, config);
  }
}

/**
 * Standard Checkout wallet component. Native Novalnet wallet buttons own the
 * user gesture; generic submit() MUST NOT impersonate wallet authorization.
 * Express Checkout (cart/shipping update callbacks) is a separate integration.
 */
export class NovalnetWallet extends BaseComponent {
  private readonly walletType: WalletType;
  private readonly componentOptions: ComponentOptions;
  private instance?: NovalnetWalletInstance;
  private configuration?: WalletConfig;
  private submitting = false;
  private completedPaymentReference?: string;

  constructor(type: WalletType, options: BaseOptions, config: ComponentOptions) {
    super(type === "GOOGLEPAY" ? PaymentMethod.googlepay : PaymentMethod.applepay, options, config);
    this.walletType = type;
    this.componentOptions = config;
  }

  private async loadConfig(): Promise<WalletConfig> {
    if (this.configuration) return this.configuration;
    const url = new URL(`${this.processorUrl.replace(/\/$/, "")}/walletConfig`, window.location.origin);
    url.searchParams.set("paymentMethod", this.walletType);
    const response = await fetch(url.toString(), {
      headers: { "X-Session-Id": this.sessionId }, cache: "no-store",
    });
    if (!response.ok) throw new Error("Wallet is unavailable or not enabled");
    const config = await response.json() as WalletConfig;
    if (!Number.isSafeInteger(config.amount) || config.amount <= 0 ||
        !/^[A-Z]{3}$/.test(config.currency) || !/^[A-Z]{2}$/.test(config.countryCode) ||
        !config.clientKey || !config.merchantName) {
      throw new Error("Invalid wallet configuration from processor");
    }
    this.configuration = config;
    return config;
  }

  private async configureInstance(): Promise<NovalnetWalletInstance> {
    if (this.instance) return this.instance;
    const config = await this.loadConfig();
    await loadWalletSdk();
    const instance = window.NovalnetPayment?.().createPaymentObject();
    if (!instance) throw new Error("Novalnet wallet SDK is unavailable");
    const locale = this.getLanguage();
    instance.setPaymentIntent({
      clientKey: config.clientKey,
      paymentIntent: {
        merchant: {
          countryCode: config.countryCode,
          paymentDataPresent: false,
          ...(this.walletType === "GOOGLEPAY" && config.partnerId ? { partnerId: config.partnerId } : {}),
        },
        transaction: {
          amount: config.amount,
          currency: config.currency,
          paymentMethod: this.walletType,
          environment: config.environment,
        },
        order: {
          paymentDataPresent: false,
          merchantName: config.merchantName,
          billing: { requiredFields: ["postalAddress", "email"] },
        },
        button: {
          locale,
          type: "buy",
          ...(this.walletType === "APPLEPAY" ? { style: "black" } : {}),
          dimensions: { width: 240, height: 48 },
        },
        callbacks: {
          onProcessCompletion: (response: any, bookingResult: (result: { status: "SUCCESS" | "FAILURE"; statusText: string }) => void) => {
            void this.handleWalletCompletion(response, bookingResult);
          },
        },
        onPaymentButtonClicked: (clicked: (result: { status: "SUCCESS" | "FAILURE" }) => void) => {
          void Promise.resolve().then(() => this.componentOptions.onPayButtonClick?.())
            .then(() => clicked({ status: "SUCCESS" }))
            .catch((error) => {
              this.onError(error);
              clicked({ status: "FAILURE" });
            });
        },
      },
    });
    this.instance = instance;
    return instance;
  }

  async isAvailable(): Promise<boolean> {
    const instance = await this.configureInstance();
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 10000);
      try {
        instance.isPaymentMethodAvailable((available) => {
          clearTimeout(timer);
          resolve(Boolean(available));
        });
      } catch {
        clearTimeout(timer);
        resolve(false);
      }
    });
  }

  async mount(selector: string): Promise<void> {
    const container = document.querySelector(selector);
    if (!container) throw new Error(`Wallet mount target not found: ${selector}`);
    const host = document.createElement("div");
    host.className = styles.wallet;
    // Novalnet API requires a CSS selector; generate a collision-resistant element ID.
    host.id = `nn-wallet-${this.walletType.toLowerCase()}-${++nextWalletId}`;
    container.appendChild(host);
    try {
      const available = await this.isAvailable();
      if (!available) {
        host.textContent = this.getLanguage() === "de"
          ? "Diese Zahlungsmethode ist auf diesem Gerät nicht verfügbar."
          : "This payment method is not available on this device.";
        return;
      }
      this.instance!.addPaymentButton(`#${host.id}`);
    } catch (error) {
      host.remove();
      this.onError(error);
      throw error;
    }
  }

  // Wallets must only be charged following the provider's native user gesture.
  submit(): void { /* No generic submit action for Apple Pay / Google Pay. */ }

  private async handleWalletCompletion(
    response: any,
    bookingResult: (result: { status: "SUCCESS" | "FAILURE"; statusText: string }) => void,
  ): Promise<void> {
    let outcome: "SUCCESS" | "FAILURE" = "FAILURE";
    let statusText = "Wallet payment failed";
    let acknowledged = false;
    const acknowledge = (status: "SUCCESS" | "FAILURE", text: string) => {
      if (acknowledged) return;
      acknowledged = true;
      bookingResult({ status, statusText: text });
    };
    try {
      if (this.completedPaymentReference) {
        // An SDK retry must not initiate a second backend payment.
        acknowledge("SUCCESS", "");
        return;
      }
      if (this.submitting) throw new Error("Wallet payment is already processing");
      this.submitting = true;
      if (response?.result?.status !== "SUCCESS") {
        throw new Error(String(response?.result?.status_text ?? statusText));
      }
      const token = response?.transaction?.token;
      if (typeof token !== "string" || token.length < 8 || token.length > 16384 || /\s/.test(token)) {
        throw new Error("Novalnet wallet token missing or invalid");
      }

      if (!this.configuration) throw new Error("Wallet configuration is unavailable");
      // Compare the SDK's reported amount if present; the server also rejects
      // stale Cart totals against the amount used to initialise the wallet sheet.
      if (response?.transaction?.amount !== undefined &&
          Number(response.transaction.amount) !== this.configuration.amount) {
        throw new Error("Wallet authorization amount does not match the Cart");
      }
      const payment: PaymentRequestSchemaDTO = {
        paymentMethod: {
          type: this.walletType, walletToken: token,
          walletAmount: this.configuration.amount,
          walletCurrency: this.configuration.currency,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
        lang: this.getLanguage(),
        path: window.location.origin,
      };
      const result = await fetch(`${this.processorUrl.replace(/\/$/, "")}/directPayment`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Id": this.sessionId },
        body: JSON.stringify(payment),
      });
      if (!result.ok) throw new Error("Wallet payment processing failed");
      const data: { paymentReference?: string; txnSecret?: string; transactionStatus?: string; transactionStatusText?: string } = await result.json();
      if (data.transactionStatus === "FAILURE" || !data.paymentReference) {
        throw new Error(data.transactionStatusText || "Wallet payment was declined");
      }
      this.completedPaymentReference = data.paymentReference;
      outcome = "SUCCESS";
      statusText = "";
      acknowledge(outcome, statusText);
      if (data.txnSecret) {
        window.location.assign(data.txnSecret);
      } else {
        this.completePayment({ isSuccess: true, paymentReference: data.paymentReference });
      }
      return;
    } catch (error) {
      statusText = error instanceof Error ? error.message : statusText;
      this.onError(statusText);
    } finally {
      this.submitting = false;
    }
    acknowledge(outcome, statusText);
  }
}
