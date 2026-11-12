import { createHash } from "node:crypto";
import { getConfig } from "../config/config";
import { projectApiRoot } from "../utils/ct-client";

const GUARANTEES = ["GUARANTEED_INVOICE", "GUARANTEED_DIRECT_DEBIT_SEPA"];
const ONE_CLICK = [
  "CREDITCARD",
  "DIRECT_DEBIT_SEPA",
  "GUARANTEED_DIRECT_DEBIT_SEPA",
  "DIRECT_DEBIT_ACH",
];
type GuaranteeCompanyCart = {
  billingAddress?: { company?: unknown; firstName?: unknown; lastName?: unknown } | null;
  businessUnit?: { key?: unknown } | null;
  businessUnitKey?: unknown;
};

export function getGuaranteeCompany(cart: GuaranteeCompanyCart): string {
  const billing = cart.billingAddress;
  const company = typeof billing?.company === "string" ? billing.company.trim() : "";
  if (company) return company;

  const businessUnitKey = (typeof cart.businessUnit?.key === "string" ? cart.businessUnit.key.trim() : "") ||
    (typeof cart.businessUnitKey === "string" ? cart.businessUnitKey.trim() : "");
  const firstName = typeof billing?.firstName === "string" ? billing.firstName.trim() : "";
  if (!businessUnitKey || !firstName) return "";
  const lastName = typeof billing?.lastName === "string" ? billing.lastName.trim() : "";
  return [firstName, lastName].filter(Boolean).join(" ");
}

export function isBusinessGuarantee(
  type: string,
  company: unknown,
  config: Record<string, any> = getConfig(),
): boolean {
  return (
    GUARANTEES.includes(type) &&
    String(config[`novalnet_${type}_Allowb2bCustomers`]) === "1" &&
    typeof company === "string" &&
    Boolean(company.trim())
  );
}
export function oneClickEnabled(
  type: string,
  config: Record<string, any> = getConfig(),
): boolean {
  return (
    ONE_CLICK.includes(type) &&
    String(config[`novalnet_${type}_OneClickShopping`]) === "1"
  );
}
type SavedPayment = {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  cardBrand?: string;
  lastFour?: string;
  expiryMonth?: string;
  expiryYear?: string;
  accountNumber?: string;
  iban?: string;
  accountLastFour?: string;
  ibanLastFour?: string;
};
type Consent = {
  customerId: string;
  type: string;
  scope: string;
  pspReference: string;
  language?: string;
  pending?: SavedPayment & { tid: string };
  savedId?: string;
  createdAt?: string;
};
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const statusCode = (error: any) => error?.statusCode ?? error?.status;

export class SavedPaymentService {
  constructor(private api: any = projectApiRoot) {}
  private scope(customerId: string, type: string): string {
    const config = getConfig() as Record<string, any>;
    return hash(
      JSON.stringify([
        customerId,
        type === "CREDITCARD" ? "CREDITCARD" : type === "DIRECT_DEBIT_ACH" ? "ACH" : "SEPA",
        String(config[`novalnet_${type}_TestMode`]) === "1" ? "1" : "0",
        config.projectKey,
        config.novalnetPublicKey,
        config.novalnetTariff,
      ]),
    );
  }
  private async get(container: string, key: string): Promise<any> {
    try {
      return (
        await this.api
          .customObjects()
          .withContainerAndKey({ container, key })
          .get()
          .execute()
      ).body;
    } catch (error) {
      if (statusCode(error) === 404) return null;
      throw error;
    }
  }
  async list(
    customerId: string | undefined,
    type: string,
    language = "en",
  ): Promise<Array<{ id: string; label: string }>> {
    if (!customerId || !oneClickEnabled(type)) return [];
    const record = await this.get(
      "nn-saved-payments",
      this.scope(customerId, type),
    );
    return (record?.value?.payments ?? [])
      .slice(0, 3)
      .map((item: SavedPayment) => ({
        id: item.id,
        label: this.formatLabel(item, type, language),
      }));
  }
  async resolve(
    customerId: string | undefined,
    type: string,
    id: string,
  ): Promise<string> {
    if (!customerId || !oneClickEnabled(type))
      throw new Error("Saved payment is not available.");
    const record = await this.get(
      "nn-saved-payments",
      this.scope(customerId, type),
    );
    const payment = record?.value?.payments?.find(
      (item: SavedPayment) => item.id === id,
    );
    if (!payment) throw new Error("Saved payment is not available.");
    return payment.token;
  }
  async remove(customerId: string | undefined, type: string, id: string): Promise<void> {
    if (!customerId || !oneClickEnabled(type)) {
      throw new Error("Saved payment is not available.");
    }
    const key = this.scope(customerId, type);
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.get("nn-saved-payments", key);
      const payments: SavedPayment[] = current?.value?.payments ?? [];
      if (!payments.some((item) => item.id === id)) return;
      try {
        await this.api.customObjects().post({
          body: {
            container: "nn-saved-payments", key, version: current.version,
            value: {
              ...current.value,
              payments: payments.filter((item) => item.id !== id),
              removedIds: { ...current.value.removedIds, [id]: new Date().toISOString() },
            },
          },
        }).execute();
        return;
      } catch (error) {
        if (statusCode(error) !== 409 || attempt === 4) throw error;
      }
    }
  }
  async consent(
    paymentId: string,
    pspReference: string,
    customerId: string | undefined,
    type: string,
    requested: unknown,
    language = "en",
  ): Promise<void> {
    if (!customerId || !oneClickEnabled(type) || requested !== true) return;
    const value: Consent = {
      customerId,
      type,
      scope: this.scope(customerId, type),
      pspReference,
      language: String(language).toLowerCase().startsWith("de") ? "de" : "en",
      createdAt: new Date().toISOString(),
    };
    await this.api
      .customObjects()
      .post({ body: { container: "nn-token-consent", key: paymentId, value } })
      .execute();
  }

  private formatLabel(item: SavedPayment, type: string, language: string): string {
    const isGerman = String(language).toLowerCase().startsWith("de");
    const legacy = String(item.label ?? "");

    if (type === "CREDITCARD") {
      let brand = String(item.cardBrand ?? "").trim();
      let lastFour = String(item.lastFour ?? "").trim();
      let expiryMonth = String(item.expiryMonth ?? "").trim();
      let expiryYear = String(item.expiryYear ?? "").trim();

      if (!brand || !lastFour) {
        const card = legacy.match(
          /^(.+?)\s+(?:ending in|mit Endziffern)\s+(\S+?)(?:\s+\((?:expires|gültig bis)\s+(\d{1,2})\/(\d{4})\))?$/i,
        );
        if (card) {
          brand = brand || card[1];
          lastFour = lastFour || card[2];
          expiryMonth = expiryMonth || card[3] || "";
          expiryYear = expiryYear || card[4] || "";
        }
      }

      const cardName = [
        brand,
        isGerman ? "mit Endziffern" : "ending in",
        lastFour,
      ].filter(Boolean).join(" ");

      const formattedMonth = expiryMonth
        ? expiryMonth.padStart(2, "0")
        : "";

      if (formattedMonth && expiryYear) {
        return `${cardName} (${isGerman ? "gültig bis" : "expires"} ${formattedMonth}/${expiryYear})`;
      }

      return cardName || legacy;
    }

    if (type === "DIRECT_DEBIT_ACH") {
      let accountNumber = String(item.accountNumber ?? "").trim();

      if (!accountNumber && legacy) {
        const account = legacy.match(/^(?:ACCOUNT NO|Kontonummer)\s+(.+)$/i);
        if (account) accountNumber = account[1].trim();
      }

      if (!accountNumber && item.accountLastFour) {
        accountNumber = String(item.accountLastFour);
      }

      return `${isGerman ? "Kontonummer" : "ACCOUNT NO"}${accountNumber ? ` ${accountNumber}` : ""}`;
    }

    let iban = String(item.iban ?? "").trim();

    if (!iban && legacy) {
      const account = legacy.match(/^IBAN\s+(.+)$/i);
      if (account) iban = account[1].trim();
    }

    if (!iban && item.ibanLastFour) {
      iban = String(item.ibanLastFour);
    }

    return `IBAN${iban ? ` ${iban}` : ""}`;
  }

  private tokenDetails(consent: Consent, data: any): SavedPayment {
    const token = String(data.token);
    const id = hash(consent.scope + ":" + token);
    const cardNumber = String(data.card_number ?? "").replace(/\s/g, "");
    const accountNumber = String(data.account_number ?? "").trim();
    const iban = String(data.iban ?? "").trim();
    const expiryMonthValue = data.card_expiry_month;

    return {
      id,
      token,
      label: "",
      createdAt: new Date().toISOString(),
      ...(consent.type === "CREDITCARD" ? {
        cardBrand: String(data.card_brand ?? "").trim(),
        lastFour: String(data.last_four ?? cardNumber.slice(-4)).slice(-4),
        expiryMonth: expiryMonthValue == null || expiryMonthValue === ""
          ? undefined
          : String(expiryMonthValue).padStart(2, "0"),
        expiryYear: data.card_expiry_year == null
          ? undefined
          : String(data.card_expiry_year),
      } : consent.type === "DIRECT_DEBIT_ACH" ? {
        accountNumber,
        accountLastFour: accountNumber.replace(/\s/g, "").slice(-4),
      } : {
        iban,
        ibanLastFour: iban.replace(/\s/g, "").slice(-4),
      }),
    };
  }
  async rememberRedirect(
    paymentId: string,
    pspReference: string,
    response: any,
  ): Promise<void> {
    if (
      response?.result?.status !== "SUCCESS" ||
      !response.result.redirect_url ||
      !response?.transaction?.payment_data?.token ||
      !response.transaction.tid ||
      response.transaction.payment_type !== "CREDITCARD" ||
      !oneClickEnabled("CREDITCARD")
    )
      return;
    const record = await this.get("nn-token-consent", paymentId);
    const consent: Consent | undefined = record?.value;
    if (
      !consent ||
      consent.pspReference !== pspReference ||
      consent.scope !== this.scope(consent.customerId, consent.type)
    )
      return;
    await this.api
      .customObjects()
      .post({
        body: {
          container: "nn-token-consent",
          key: paymentId,
          version: record.version,
          value: {
            ...consent,
            pending: {
              ...this.tokenDetails(consent, response.transaction.payment_data),
              tid: String(response.transaction.tid),
            },
          },
        },
      })
      .execute();
  }
  async saveResponse(
    paymentId: string,
    pspReference: string,
    response: any,
  ): Promise<void> {
    if (String(response?.result?.status).toUpperCase() !== "SUCCESS") return;
    const state = String(response?.transaction?.status).toUpperCase();
    const actualType = String(response?.transaction?.payment_type);
    if (
      !["CONFIRMED", "ON_HOLD", "PENDING"].includes(state) ||
      !(
        oneClickEnabled(actualType) ||
        (actualType === "DIRECT_DEBIT_SEPA" &&
          oneClickEnabled("GUARANTEED_DIRECT_DEBIT_SEPA"))
      )
    )
      return;
    const record = await this.get("nn-token-consent", paymentId);
    const consent: Consent | undefined = record?.value;
    if (
      !consent ||
      consent.pspReference !== pspReference ||
      !oneClickEnabled(consent.type) ||
      consent.scope !== this.scope(consent.customerId, consent.type)
    )
      return;
    if (
      consent.type === "CREDITCARD"
        ? actualType !== "CREDITCARD" || state === "PENDING"
        : consent.type === "DIRECT_DEBIT_ACH"
          ? actualType !== "DIRECT_DEBIT_ACH"
          : !["DIRECT_DEBIT_SEPA", "GUARANTEED_DIRECT_DEBIT_SEPA"].includes(
            actualType,
          )
    )
      return;
    const data = response?.transaction?.payment_data;
    const item = data?.token
      ? this.tokenDetails(consent, data)
      : consent.pending?.tid === String(response.transaction.tid)
        ? consent.pending
        : undefined;
    if (!item) return;
    if (
      data?.token &&
      consent.pending?.token === String(data.token) &&
      !data.card_number &&
      !data.iban &&
      !data.account_number
    ) {
      Object.assign(item, consent.pending);
    }
    const { id } = item;
    const markSaved = async () => {
      for (let retry = 0; retry < 3; retry++) {
        const latest = await this.get("nn-token-consent", paymentId);
        if (!latest || latest.value.savedId === id) return;
        const value = { ...latest.value, savedId: id };
        delete value.pending;
        try {
          await this.api
            .customObjects()
            .post({
              body: {
                container: "nn-token-consent",
                key: paymentId,
                version: latest.version,
                value,
              },
            })
            .execute();
          return;
        } catch (error) {
          if (statusCode(error) !== 409 || retry === 2) throw error;
        }
      }
    };
    for (let attempt = 0; attempt < 5; attempt++) {
      const current = await this.get("nn-saved-payments", consent.scope);
      const payments: SavedPayment[] = current?.value?.payments ?? [];
      const removedAt = current?.value?.removedIds?.[id];
      if (removedAt && (!consent.createdAt || consent.createdAt <= removedAt)) return;
      try {
        const existing = payments.find((payment) => payment.id === id);

        const incomingDetails = Object.fromEntries(
          Object.entries(item).filter(([, value]) => value !== undefined && value !== ""),
        );
        const mergedItem: SavedPayment & { tid?: string } = {
          ...(existing ?? {}),
          ...incomingDetails,
        } as SavedPayment & { tid?: string };

        delete mergedItem.tid;

        const nextPayments = existing
          ? payments.map((payment) => payment.id === id ? mergedItem : payment)
          : [mergedItem, ...payments];

        await this.api
          .customObjects()
          .post({
            body: {
              container: "nn-saved-payments",
              key: consent.scope,
              version: current?.version ?? 0,
              value: {
                ...current?.value,
                payments: nextPayments,
              },
            },
          })
          .execute();

        await markSaved();
        return;
      } catch (error) {
        if (statusCode(error) !== 409 || attempt === 4) throw error;
      }
    }
  }
}
export default new SavedPaymentService();
