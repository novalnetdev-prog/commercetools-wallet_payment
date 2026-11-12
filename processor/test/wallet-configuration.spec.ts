import { getConfig } from "../src/config/config";
import { isWalletEnabled, isWalletMethod, validWalletToken } from "../src/utils/wallet-configuration";

describe("Novalnet wallet safeguards", () => {
  const config = getConfig();
  const original = {
    clientKey: config.novalnetClientkey,
    merchantName: config.novalnetWalletMerchantName,
    country: config.novalnetWalletMerchantCountry,
  };
  afterEach(() => {
    config.novalnetClientkey = original.clientKey;
    config.novalnetWalletMerchantName = original.merchantName;
    config.novalnetWalletMerchantCountry = original.country;
  });
  test("both wallets require complete merchant configuration without enable flags", () => {
    config.novalnetClientkey = "public-test-client-key";
    config.novalnetWalletMerchantName = "Merchant";
    config.novalnetWalletMerchantCountry = "DE";
    expect(isWalletEnabled("GOOGLEPAY")).toBe(true);
    expect(isWalletEnabled("APPLEPAY")).toBe(true);

    config.novalnetClientkey = "";
    expect(isWalletEnabled("GOOGLEPAY")).toBe(false);
    expect(isWalletEnabled("APPLEPAY")).toBe(false);

    config.novalnetClientkey = "public-test-client-key";
    config.novalnetWalletMerchantName = "";
    expect(isWalletEnabled("GOOGLEPAY")).toBe(false);
    expect(isWalletEnabled("APPLEPAY")).toBe(false);

    config.novalnetWalletMerchantName = "Merchant";
    config.novalnetWalletMerchantCountry = "invalid country";
    expect(isWalletEnabled("GOOGLEPAY")).toBe(false);
    expect(isWalletEnabled("APPLEPAY")).toBe(false);
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
