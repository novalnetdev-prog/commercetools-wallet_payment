import { enabledDropinMethods } from "../src/utils/dropin-methods";

describe("Drop-in allow-list", () => {
  test("disabled by default", () => {
    expect(enabledDropinMethods(undefined)).toEqual([]);
    expect(enabledDropinMethods("")).toEqual([]);
  });
  test("parses implemented methods (wallet feature gates are checked by the service)", () => {
    expect(enabledDropinMethods(" creditcard, sepa,APPLEPAY, paypal , creditcard, googlepay"))
      .toEqual(["creditcard", "sepa", "applepay", "paypal", "googlepay"]);
  });
  test("ignores unknown options", () => {
    expect(enabledDropinMethods("wallet, instalment, dropin")).toEqual([]);
  });
});
