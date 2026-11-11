import { getConfig } from "../src/config/config";
import { isWalletEnabled, isWalletMethod, validWalletToken } from "../src/utils/wallet-configuration";

describe("Novalnet wallet safeguards", () => {
  const config = getConfig();
  const original = {
    enabledGp: config.novalnetGooglePayEnabled,
    enabledAp: config.novalnetApplePayEnabled,
    clientKey: config.novalnetClientkey,
    merchantName: config.novalnetWalletMerchantName,
    country: config.novalnetWalletMerchantCountry,
  };
  afterEach(() => {
    config.novalnetGooglePayEnabled = original.enabledGp;
    config.novalnetApplePayEnabled = original.enabledAp;
    config.novalnetClientkey = original.clientKey;
    config.novalnetWalletMerchantName = original.merchantName;
    config.novalnetWalletMerchantCountry = original.country;
  });
  test("wallets require explicit opt-in and complete merchant configuration", () => {
    config.novalnetGooglePayEnabled = false;
    config.novalnetApplePayEnabled = false;
    config.novalnetClientkey = "public-test-client-key";
    config.novalnetWalletMerchantName = "Merchant";
    config.novalnetWalletMerchantCountry = "DE";
    expect(isWalletEnabled("GOOGLEPAY")).toBe(false);
    expect(isWalletEnabled("APPLEPAY")).toBe(false);
    config.novalnetGooglePayEnabled = true;
    expect(isWalletEnabled("GOOGLEPAY")).toBe(true);
    expect(isWalletEnabled("APPLEPAY")).toBe(false);
    config.novalnetWalletMerchantCountry = "invalid country";
    expect(isWalletEnabled("GOOGLEPAY")).toBe(false);
  });
  test("only the two explicit wallet method codes are accepted", () => {
    expect(isWalletMethod("GOOGLEPAY")).toBe(true);
    expect(isWalletMethod("APPLEPAY")).toBe(true);
    expect(isWalletMethod("CREDITCARD")).toBe(false);
    expect(isWalletMethod("APPLEPAY_EXTRA")).toBe(false);
  });
  test("rejects missing or whitespace-injected wallet tokens", () => {
    expect(validWalletToken(undefined)).toBe(false);
    expect(validWalletToken("bad")).toBe(false);
    expect(validWalletToken("wallet token invalid")).toBe(false);
    expect(validWalletToken("secure-test-wallet-token-123")).toBe(true);
    expect(validWalletToken("x".repeat(16385))).toBe(false);
  });
});
