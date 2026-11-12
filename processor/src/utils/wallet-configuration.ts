import { getConfig } from "../config/config";

export type WalletMethod = "GOOGLEPAY" | "APPLEPAY";

export function isWalletMethod(type: string): type is WalletMethod {
  return type === "GOOGLEPAY" || type === "APPLEPAY";
}

/** Both wallets require valid server-side Novalnet merchant settings.
 * Actual wallet availability also depends on PSP activation and the browser SDK.
 */
export function isWalletEnabled(_type: WalletMethod): boolean {
  const config = getConfig();
  return Boolean(config.novalnetClientkey?.trim()) &&
    Boolean(config.novalnetWalletMerchantName?.trim()) &&
    /^[A-Z]{2}$/.test(config.novalnetWalletMerchantCountry.trim().toUpperCase());
}

/** Wallet tokens are one-time Novalnet SDK outputs, not saved-card tokens. */
export function validWalletToken(value: unknown): value is string {
  return typeof value === "string" && value.length >= 8 && value.length <= 16384 &&
    value === value.trim() && !/\s/.test(value);
}
