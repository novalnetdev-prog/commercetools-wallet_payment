jest.mock("../src/libs/logger", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
import { NovalnetPaymentService } from "../src/services/novalnet-payment.service";
import { config } from "../src/config/config";
import savedPayments from "../src/services/saved-payment.service";
import { PaymentOutcome } from "../src/dtos/novalnet-payment.dto";
jest.mock("../src/utils/ct-client", () => ({
  projectApiRoot: {
    customers: () => ({
      withId: () => ({
        get: () => ({
          execute: async () => ({
            body: { firstName: "Max", lastName: "Mustermann" },
          }),
        }),
      }),
    }),
  },
}));
jest.mock("../src/utils/custom-fields", () => ({
  createTransactionCommentsType: async () => {},
  createOrderPaymentCommentsType: async () => {},
}));
jest.mock("../src/payment-sdk", () => ({
  paymentSDK: {
    ctCartService: {
      getOneShippingAddress: ({ cart }: any) => cart.shippingAddress,
    },
  },
  appLogger: {},
}));
jest.mock("../src/libs/fastify/context/context", () => ({
  getCartIdFromContext: () => "authenticated-cart",
  getFutureOrderNumberFromContext: () => "order",
  getPaymentInterfaceFromContext: () => "novalnet",
  getProcessorUrlFromContext: () => "https://processor.example",
  getCtSessionIdFromContext: () => "session",
}));
jest.mock("../src/services/saved-payment.service", () => ({
  __esModule: true,
  ...jest.requireActual("../src/services/saved-payment.service"),
  default: {
    list: jest.fn(async () => []),
    resolve: jest.fn(async () => "private-token"),
    consent: jest.fn(async () => {}),
    saveResponse: jest.fn(async () => {}),
    rememberRedirect: jest.fn(async () => {}),
  },
}));
const address = {
  city: "Berlin",
  country: "DE",
  streetName: "Street, 1",
  postalCode: "10115",
  company: "ACME GmbH",
  firstName: "Max",
  lastName: "Mustermann",
};
const cart = {
  id: "cart",
  version: 1,
  billingAddress: address,
  shippingAddress: address,
  taxedPrice: { totalGross: { centAmount: 2500, currencyCode: "EUR" } },
};
function setup(extra: any = {}) {
  const ctCartService: any = {
    getCart: jest.fn(async () => ({ ...cart, ...extra })),
    addPayment: jest.fn(async () => {}),
    getPaymentAmount: jest.fn(async () => ({
      centAmount: 2500,
      currencyCode: "EUR",
    })),
  };
  const ctPaymentService: any = {
    createPayment: jest.fn(async () => ({
      id: "payment",
      amountPlanned: { centAmount: 2500, currencyCode: "EUR" },
    })),
    updatePayment: jest.fn(async () => {}),
  };
  const service = new NovalnetPaymentService({
    ctCartService,
    ctPaymentService,
  });
  const dispatch = jest
    .spyOn(service as any, "callNovalnet")
    .mockRejectedValue(new Error("stop after recording payload"));
  return { service, dispatch, ctCartService };
}
beforeEach(() => {
  jest.clearAllMocks();
  Object.assign(config, {
    novalnet_GUARANTEED_INVOICE_Allowb2bCustomers: "1",
    novalnet_GUARANTEED_DIRECT_DEBIT_SEPA_Allowb2bCustomers: "1",
    novalnet_CREDITCARD_OneClickShopping: "1",
    novalnet_DIRECT_DEBIT_SEPA_OneClickShopping: "1",
  });
});
test.each(["GUARANTEED_INVOICE", "GUARANTEED_DIRECT_DEBIT_SEPA"])(
  "company comes from billingAddress.company and DOB omitted for enabled B2B: %s",
  async (type) => {
    const { service, dispatch } = setup();
    await expect(
      service.createDirectPayment({
        data: {
          paymentMethod: { type, birthdate: "12.03.1990" },
          paymentOutcome: PaymentOutcome.AUTHORIZED,
        },
      }),
    ).rejects.toThrow("Payment processing failed");
    const payload: any = dispatch.mock.calls[0][1];
    expect(payload.customer.billing.company).toBe("ACME GmbH");
    expect(payload.customer).not.toHaveProperty("birth_date");
  },
);
test("B2B disabled preserves DOB; address instructions do not become company", async () => {
  config.novalnet_GUARANTEED_INVOICE_Allowb2bCustomers = "0";
  const { service, dispatch } = setup({
    billingAddress: { ...address, additionalAddressInfo: "Door code 123" },
  });
  await expect(
    service.createDirectPayment({
      data: {
        paymentMethod: { type: "GUARANTEED_INVOICE", birthdate: "12.03.1990" },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    }),
  ).rejects.toThrow();
  const payload: any = dispatch.mock.calls[0][1];
  expect(payload.customer.birth_date).toBe("1990-03-12");
  expect(payload.customer.billing).not.toHaveProperty("company");
});
test("feature response uses authenticated Cart; guest one-click hidden", async () => {
  const { service, ctCartService } = setup();
  expect(await service.getPaymentFeatures("GUARANTEED_INVOICE")).toEqual({
    business: true,
    oneClick: false,
    savedPayments: [],
  });
  expect(ctCartService.getCart).toHaveBeenCalledWith({
    id: "authenticated-cart",
  });
  expect((await service.getPaymentFeatures("CREDITCARD")).oneClick).toBe(false);
  await expect(service.getPaymentFeatures("PAYPAL")).rejects.toThrow();
});
test("guest save flag does not request a token", async () => {
  const { service, dispatch } = setup();
  await expect(
    service.createDirectPayment({
      data: {
        paymentMethod: { type: "DIRECT_DEBIT_SEPA", savePayment: true },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    }),
  ).rejects.toThrow();
  expect((dispatch.mock.calls[0][1] as any).transaction).not.toHaveProperty(
    "create_token",
  );
  expect(savedPayments.consent).not.toHaveBeenCalled();
});
test.each([true, false])(
  "registered consent=%s controls create_token and is persisted before PSP dispatch",
  async (consent) => {
    const { service, dispatch } = setup({ customerId: "customer" });
    await expect(
      service.createDirectPayment({
        data: {
          paymentMethod: { type: "DIRECT_DEBIT_SEPA", savePayment: consent },
          paymentOutcome: PaymentOutcome.AUTHORIZED,
        },
      }),
    ).rejects.toThrow();
    const payload: any = dispatch.mock.calls[0][1];
    if (consent) {
      expect(payload.transaction.create_token).toBe(1);
      expect(savedPayments.consent).toHaveBeenCalledWith(
        "payment",
        expect.any(String),
        "customer",
        "DIRECT_DEBIT_SEPA",
        true,
        "en",
      );
      expect(
        (savedPayments.consent as jest.Mock).mock.invocationCallOrder[0],
      ).toBeLessThan(dispatch.mock.invocationCallOrder[0]);
    } else {
      expect(payload.transaction).not.toHaveProperty("create_token");
      expect(savedPayments.consent).not.toHaveBeenCalled();
    }
  },
);
test("saved card sends only server-resolved token and preserves 3DS return support", async () => {
  const { service, dispatch } = setup({ customerId: "customer" });
  await expect(
    service.createDirectPayment({
      data: {
        paymentMethod: {
          type: "CREDITCARD",
          savedPaymentId: "owned-id",
          savePayment: true,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
        path: "https://shop.example",
      },
    }),
  ).rejects.toThrow();
  expect(savedPayments.resolve).toHaveBeenCalledWith(
    "customer",
    "CREDITCARD",
    "owned-id",
  );
  const payload: any = dispatch.mock.calls[0][1];
  expect(payload.transaction.payment_data).toEqual({ token: "private-token" });
  expect(payload.transaction).not.toHaveProperty("return_url");
  expect(payload.transaction).not.toHaveProperty("create_token");
});
test("unowned saved ID is rejected before PSP dispatch", async () => {
  const { service, dispatch } = setup();
  (savedPayments.resolve as jest.Mock).mockRejectedValueOnce(
    new Error("not owned"),
  );
  await expect(
    service.createDirectPayment({
      data: {
        paymentMethod: { type: "CREDITCARD", savedPaymentId: "forged" },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    }),
  ).rejects.toThrow("Saved payment is not available");
  expect(dispatch).not.toHaveBeenCalled();
});
test("new 3DS card request retains authorize decision and includes consent", async () => {
  const { service, dispatch } = setup({ customerId: "customer" });
  config.novalnet_CREDITCARD_PaymentAction = "authorize";
  config.novalnet_CREDITCARD_MinimumAmount = "0";
  await expect(
    service.createRedirectPayment({
      data: {
        paymentMethod: {
          type: "CREDITCARD",
          panHash: "hash",
          uniqueId: "unique",
          savePayment: true,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
        path: "https://shop.example",
      },
    }),
  ).rejects.toThrow("Payment initialization failed");
  expect(dispatch.mock.calls[0][0]).toBe(
    "https://payport.novalnet.de/v2/authorize",
  );
  const payload: any = dispatch.mock.calls[0][1];
  expect(payload.transaction.create_token).toBe(1);
  expect(payload.transaction.payment_data).toEqual({
    pan_hash: "hash",
    unique_id: "unique",
  });
  expect(savedPayments.consent).toHaveBeenCalledWith(
    "payment",
    expect.any(String),
    "customer",
    "CREDITCARD",
    true,
    "en",
  );
});
test("saved SEPA uses only the stored token; no new IBAN is required", async () => {
  const { service, dispatch } = setup({ customerId: "customer" });
  await expect(
    service.createDirectPayment({
      data: {
        paymentMethod: {
          type: "DIRECT_DEBIT_SEPA",
          savedPaymentId: "owned-id",
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    }),
  ).rejects.toThrow("Payment processing failed");
  expect((dispatch.mock.calls[0][1] as any).transaction.payment_data).toEqual({
    token: "private-token",
  });
});
test("disabling one-click ignores a client save flag for a registered customer", async () => {
  config.novalnet_DIRECT_DEBIT_SEPA_OneClickShopping = "0";
  const { service, dispatch } = setup({ customerId: "customer" });
  await expect(
    service.createDirectPayment({
      data: {
        paymentMethod: { type: "DIRECT_DEBIT_SEPA", savePayment: true },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    }),
  ).rejects.toThrow();
  expect((dispatch.mock.calls[0][1] as any).transaction).not.toHaveProperty(
    "create_token",
  );
  expect(savedPayments.consent).not.toHaveBeenCalled();
});

test.each([
  ["en", "EN"],
  ["en-us", "EN"],
  ["de", "DE"],
  ["de-de", "DE"],
  ["de-DE", "DE"],
])("direct payments send %s as %s to Novalnet", async (input, expected) => {
  const { service, dispatch } = setup();
  await expect(
    service.createDirectPayment({
      data: {
        paymentMethod: { type: "INVOICE" },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
        lang: input,
      },
    }),
  ).rejects.toThrow("Payment processing failed");
  const payload: any = dispatch.mock.calls[0][1];
  expect(payload.custom.lang).toBe(expected);
  expect(payload.custom.inputval3).toBe(expected.toLowerCase());
});

test.each([
  ["de-de", "DE"],
  ["en-us", "EN"],
])("redirect payment uses %s for the return URL but %s for PSP localization", async (input, expected) => {
  const { service, dispatch } = setup({ customerId: "customer" });
  await expect(
    service.createRedirectPayment({
      data: {
        paymentMethod: {
          type: "CREDITCARD",
          panHash: "hash",
          uniqueId: "unique",
          savePayment: true,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
        lang: input,
        path: "https://shop.example",
      },
    }),
  ).rejects.toThrow("Payment initialization failed");
  const payload: any = dispatch.mock.calls[0][1];
  expect(payload.custom.lang).toBe(expected);
  expect(payload.custom.inputval3).toBe(expected.toLowerCase());
  expect(new URL(payload.transaction.return_url).searchParams.get("lang")).toBe(input);
  expect(savedPayments.consent).toHaveBeenCalledWith(
    "payment", expect.any(String), "customer", "CREDITCARD", true, expected.toLowerCase(),
  );
});
