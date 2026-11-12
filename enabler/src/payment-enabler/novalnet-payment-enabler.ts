import { InvoiceBuilder } from "../components/payment-methods/invoice/invoice";
import { PrepaymentBuilder } from "../components/payment-methods/prepayment/prepayment";
import { GuaranteedInvoiceBuilder } from "../components/payment-methods/GuaranteedInvoice/GuaranteedInvoice";
import { GuaranteedSepaBuilder } from "../components/payment-methods/GuaranteedSepa/GuaranteedSepa";
import { IdealBuilder } from "../components/payment-methods/ideal/ideal";
import { PaypalBuilder } from "../components/payment-methods/paypal/paypal";
import { OnlinebanktransferBuilder } from "../components/payment-methods/onlinebanktransfer/onlinebanktransfer";
import { AlipayBuilder } from "../components/payment-methods/alipay/alipay";
import { BancontactBuilder } from "../components/payment-methods/bancontact/bancontact";
import { BlikBuilder } from "../components/payment-methods/blik/blik";
import { EpsBuilder } from "../components/payment-methods/eps/eps";
import { MbwayBuilder } from "../components/payment-methods/mbway/mbway";
import { MultibancoBuilder } from "../components/payment-methods/multibanco/multibanco";
import { PostfinanceBuilder } from "../components/payment-methods/postfinance/postfinance";
import { PostfinancecardBuilder } from "../components/payment-methods/postfinancecard/postfinancecard";
import { Przelewy24Builder } from "../components/payment-methods/przelewy24/przelewy24";
import { TrustlyBuilder } from "../components/payment-methods/trustly/trustly";
import { TwintBuilder } from "../components/payment-methods/twint/twint";
import { WechatpayBuilder } from "../components/payment-methods/wechatpay/wechatpay";
import { PixBuilder } from "../components/payment-methods/pix/pix";
import { BoletoBuilder } from "../components/payment-methods/boleto/boleto";
import { BizumBuilder } from "../components/payment-methods/bizum/bizum";
import { BancomatpayBuilder } from "../components/payment-methods/bancomatpay/bancomatpay";
import { KakaopayBuilder } from "../components/payment-methods/kakaopay/kakaopay";
import { NaverpayBuilder } from "../components/payment-methods/naverpay/naverpay";
import { SepaBuilder } from "../components/payment-methods/sepa/sepa";
import { AchBuilder } from "../components/payment-methods/ach/ach";
import { CreditcardBuilder } from "../components/payment-methods/creditcard/creditcard";
import { GooglePayBuilder, ApplePayBuilder } from "../components/payment-methods/wallet/wallet";
import { NovalnetDropinBuilder, DROPIN_LABELS } from "../components/payment-methods/dropin/dropin";
import { clearPaymentError, showPaymentError, showReturnedPaymentError } from './payment-error';
import {
  EnablerOptions,
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
  PaymentResult,
} from "./payment-enabler";

declare global {
  interface ImportMeta {
    env: any;
  }
}

export type BaseOptions = {
  processorUrl: string;
  sessionId: string;
  locale?: string;
  onComplete: (result: PaymentResult) => void;
  onError: (error: any, context?: { paymentReference?: string }) => void;
};

export class NovalnetPaymentEnabler implements PaymentEnabler {
  setupData: Promise<{ baseOptions: BaseOptions }>;

  constructor(options: EnablerOptions) {
    this.setupData = NovalnetPaymentEnabler._Setup(options);
  }

  private static _Setup = async (
    options: EnablerOptions
  ): Promise<{ baseOptions: BaseOptions }> => {
    showReturnedPaymentError();

    return Promise.resolve({
      baseOptions: {
        processorUrl: options.processorUrl,
        sessionId: options.sessionId,
        locale: options.locale,
        onComplete: (result) => {
          clearPaymentError();
          options.onComplete?.(result);
        },
        onError: (error, context) => {
          // Checkout may show a generic message; retain safe diagnostics in DevTools.
          // Do not log session IDs, customer details, payment tokens, or PSP responses.
          console.error("[Novalnet][payment][error]", {
            name: error instanceof Error ? error.name : typeof error,
            message: error instanceof Error ? error.message : "Payment component reported an error",
            stack: error instanceof Error ? error.stack : undefined,
            hasPaymentReference: Boolean(context?.paymentReference),
          });
          showPaymentError(error);
          options.onError?.(error, context);
        },
      },
    });
  };

  /** Create an embedded Drop-in only when merchant configuration enables it. */
  async createDropinBuilder(type: "embedded"): Promise<PaymentDropinBuilder> {
    if (type !== "embedded") throw new Error(`Unsupported Drop-in type: ${type}`);
    const { baseOptions } = await this.setupData;
    const configPath = "/operations/config";
    let response: Response;
    try {
      response = await fetch(`${baseOptions.processorUrl.replace(/\/+$/, "")}${configPath}`, {
        headers: { "X-Session-Id": baseOptions.sessionId },
        cache: "no-store",
      });
    } catch (error) {
      console.error("[Novalnet][Drop-in][config] Network request failed", {
        path: configPath,
        message: error instanceof Error ? error.message : "Unknown network error",
      });
      throw new Error("Unable to connect to Novalnet Drop-in configuration");
    }
    if (!response.ok) {
      // HTTP status + request ID let us correlate browser failures with processor logs.
      // Never dump full response bodies: they can include sensitive diagnostics.
      const requestId = response.headers.get("x-request-id") ?? response.headers.get("x-correlation-id");
      console.error("[Novalnet][Drop-in][config] HTTP error", {
        path: configPath,
        status: response.status,
        requestId: requestId || undefined,
      });
      throw new Error(`Novalnet Drop-in configuration failed (HTTP ${response.status})`);
    }
    let configuration: { dropinMethods?: unknown };
    try {
      configuration = await response.json();
    } catch (error) {
      console.error("[Novalnet][Drop-in][config] Invalid JSON response", {
        path: configPath,
        status: response.status,
        message: error instanceof Error ? error.message : "Unknown parse error",
      });
      throw new Error("Invalid Novalnet Drop-in configuration response");
    }
    const methods = Array.isArray(configuration?.dropinMethods)
      ? configuration.dropinMethods.filter(
          (method): method is string => typeof method === "string" && method in DROPIN_LABELS,
        )
      : [];
    if (!methods.length) {
      console.error("[Novalnet][Drop-in][config] No supported methods returned", {
        path: configPath,
        hasMethodsArray: Array.isArray(configuration?.dropinMethods),
        configuredMethodCount: Array.isArray(configuration?.dropinMethods) ? configuration.dropinMethods.length : 0,
      });
      throw new Error("Novalnet Drop-in is not enabled for this merchant");
    }
    const locale = String(baseOptions.locale ?? "").toLowerCase().startsWith("de") ? "de" : "en";
    return new NovalnetDropinBuilder(methods, (method) => this.createComponentBuilder(method), locale);
  }

  async createComponentBuilder(
    type: string
  ): Promise<PaymentComponentBuilder | never> {
  
    const { baseOptions } = await this.setupData;
    showReturnedPaymentError(true);
    
    const normalizedType = type
      ?.trim()
      .toLowerCase();

    let paymentType = normalizedType;
  
    if (normalizedType.includes('ideal')) {
      paymentType = 'ideal';
    }
  
    if (normalizedType.includes('direct debit sepa') || normalizedType.includes('sepa') || normalizedType.includes('Direct Debit SEPA')) {
      paymentType = 'sepa';
    }

    if (normalizedType.includes('direct debit ach') || normalizedType.includes('ach') || normalizedType.includes('Direct Debit ACH')) {
      paymentType = 'ach';
    }

    if (normalizedType.includes('online bank transfer') || normalizedType.includes('onlinebanktransfer') || normalizedType.includes('Online bank transfer')) {
      paymentType = 'onlinebanktransfer';
    }

    if (normalizedType.includes('credit/debit cards') || normalizedType.includes('creditcard') || normalizedType.includes('Credit/Debit Cards')) {
      paymentType = 'creditcard';
    }
    if (/^google\s*pay$/.test(normalizedType)) paymentType = "googlepay";
    if (/^apple\s*pay$/.test(normalizedType)) paymentType = "applepay";

    if (normalizedType.includes('mb way') || normalizedType.includes('mbway') || normalizedType.includes('MB Way')) {
      paymentType = 'mbway';
    }

    if (normalizedType.includes('invoice with payment guarantee') || normalizedType.includes("guaranteedinvoice") || normalizedType.includes('GuaranteedInvoice') || normalizedType.includes('Invoice with payment guarantee')) {
      paymentType = 'guaranteedinvoice';
    }

    if (normalizedType.includes('direct debit sepa with payment guarantee') || normalizedType.includes("guaranteedsepa") || normalizedType.includes('GuaranteedSepa') || normalizedType.includes('Direct Debit SEPA with payment guarantee')) {
      paymentType = 'guaranteedsepa';
    }

    if (normalizedType.includes('postFinance card') || normalizedType.includes('postfinancecard') || normalizedType.includes('PostFinance Card')) {
      paymentType = 'postfinancecard';
    }

    if (normalizedType.includes('postFinance e-finance') || normalizedType.includes('postfinance') || normalizedType.includes('PostFinance E-Finance')) {
      paymentType = 'postfinance';
    }

    const supportedMethods = {
      invoice: InvoiceBuilder,
      prepayment: PrepaymentBuilder,
      guaranteedinvoice: GuaranteedInvoiceBuilder,
      guaranteedsepa: GuaranteedSepaBuilder,
      ideal: IdealBuilder,
      paypal: PaypalBuilder,
      onlinebanktransfer: OnlinebanktransferBuilder,
      alipay: AlipayBuilder,
      bancontact: BancontactBuilder,
      blik: BlikBuilder,
      eps: EpsBuilder,
      mbway: MbwayBuilder,
      multibanco: MultibancoBuilder,
      postfinance: PostfinanceBuilder,
      postfinancecard: PostfinancecardBuilder,
      przelewy24: Przelewy24Builder,
      trustly: TrustlyBuilder,
      twint: TwintBuilder,
      wechatpay: WechatpayBuilder,
      pix: PixBuilder,
      boleto: BoletoBuilder,
      bizum: BizumBuilder,
      "bancomat pay": BancomatpayBuilder,
      bancomatpay: BancomatpayBuilder,
      kakaopay: KakaopayBuilder,
      "kakao pay": KakaopayBuilder,
      naverpay: NaverpayBuilder,
      "naver pay": NaverpayBuilder,
      sepa: SepaBuilder,
      ach: AchBuilder,
      creditcard: CreditcardBuilder,
      googlepay: GooglePayBuilder,
      applepay: ApplePayBuilder,
    };
  
    const Builder = supportedMethods[paymentType];
  
    if (!Builder) {
      throw new Error(`Unsupported payment type: ${type}`);
    }
  
    return new Builder(baseOptions);
  }

}
