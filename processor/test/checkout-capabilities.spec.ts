import { Value } from "@sinclair/typebox/value";
import { SupportedPaymentComponentsSchema } from "../src/dtos/operations/payment-componets.dto";

describe("commercetools Checkout capability discovery shape", () => {
  test("advertises one embedded drop-in without claiming express support", () => {
    const result = {
      dropins: [{ type: "embedded" }],
      components: [{ type: "creditcard" }, { type: "googlepay" }],
      express: [],
    };
    expect(Value.Check(SupportedPaymentComponentsSchema, result)).toBe(true);
  });

  test("supports an opt-out with empty dropin and express arrays", () => {
    const result = { dropins: [], components: [{ type: "invoice" }], express: [] };
    expect(Value.Check(SupportedPaymentComponentsSchema, result)).toBe(true);
  });

  test("missing discovery fields are rejected rather than silently filtered", () => {
    expect(Value.Check(SupportedPaymentComponentsSchema, {
      components: [{ type: "invoice" }],
    })).toBe(false);
  });
});
