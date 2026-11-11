import { redirectFailureResponse } from "../src/utils/redirect-failure";

describe("redirect failure response mapping", () => {
  test("successful PSP result does not produce a failure response", () => {
    expect(redirectFailureResponse("payment-1", {
      result: { status: "SUCCESS" },
    })).toBeNull();
  });

  test("preserves Novalnet failure reason and payment reference", () => {
    expect(redirectFailureResponse("payment-1", {
      result: { status: "FAILURE", status_text: "Card declined" },
    })).toEqual({
      paymentReference: "payment-1",
      transactionStatus: "FAILURE",
      transactionStatusText: "Card declined",
    });
  });

  test("falls back when the gateway omits a failure reason", () => {
    expect(redirectFailureResponse("payment-2", undefined)).toEqual({
      paymentReference: "payment-2",
      transactionStatus: "FAILURE",
      transactionStatusText: "Payment initialization failed",
    });
  });
});
