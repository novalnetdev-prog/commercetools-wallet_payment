import { getConfig } from "../config/config";

export type WalletMethod = "GOOGLEPAY" | "APPLEPAY";

export function isWalletMethod(type: string): type is WalletMethod {
  return type === "GOOGLEPAY" || type === "APPLEPAY";
}

/** Merchant-controlled feature gate, never inferred from browser-provided values. */
export function isWalletEnabled(type: WalletMethod): boolean {
  const config = getConfig();
  const enabled = type === "GOOGLEPAY" ? config.novalnetGooglePayEnabled : config.novalnetApplePayEnabled;
  return enabled && Boolean(config.novalnetClientkey?.trim()) &&
    Boolean(config.novalnetWalletMerchantName?.trim()) &&
    /^[A-Z]{2}$/.test(config.novalnetWalletMerchantCountry.trim().toUpperCase());
}

/** Wallet tokens are one-time Novalnet SDK outputs, not saved-card tokens. */
export function validWalletToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 16384 &&
    value === value.trim() && !/\s/.test(value);
}
