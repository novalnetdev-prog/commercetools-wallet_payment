import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  ConfigResponse,
  ModifyPayment,
  StatusResponse,
} from "../src/services/types/operation.type";
import {
  mockGetPaymentResult,
  mockGetPaymentResultWithoutTransactions,
  mockUpdatePaymentResult,
  mockUpdatePaymentResultWithRefundTransaction,
} from "./utils/novalnet-payment-results";
import { mockGetCartResult } from "./utils/mock-cart-data";
import {
  CreatePaymentRequest,
  NovalnetPaymentServiceOptions,
} from "../src/services/types/novalnet-payment.type";
import { AbstractPaymentService } from "../src/services/abstract-payment.service";
import { NovalnetPaymentService } from "../src/services/novalnet-payment.service";
import * as FastifyContext from "../src/libs/fastify/context/context";
import * as StatusHandler from "@commercetools/connect-payments-sdk/dist/api/handlers/status.handler";

import { HealthCheckResult } from "@commercetools/connect-payments-sdk";
import {
  PaymentMethodType,
  PaymentOutcome,
} from "../src/dtos/novalnet-payment.dto";
import { TransactionDraftDTO } from "../src/dtos/operations/transaction.dto";

// Inject test-only commercetools services.
let mockPaymentInteractionId = "";

jest.mock("../src/payment-sdk", () => ({
  paymentSDK: {
    ctAuthorizationService: {},
    ctCartService: {
      getOneShippingAddress: ({ cart }: any) =>
        cart.shippingAddress ?? null,
    },
  },
  appLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Prevent real commercetools Custom Type operations.
jest.mock("../src/utils/custom-fields", () => ({
  createTransactionCommentsType: jest.fn(async () => {}),
  createOrderPaymentCommentsType: jest.fn(async () => {}),
}));

jest.mock("../src/services/ct-custom-object.service", () => ({
  __esModule: true,
  default: {
    upsert: jest.fn(async () => {}),
  },
}));

// Simulate commercetools Payment API transactions.
jest.mock("../src/utils/ct-client", () => ({
  projectApiRoot: {
    payments: () => ({
      withId: () => ({
        post: () => ({
          execute: async () => ({
            body: { id: "123456" },
          }),
        }),
        get: () => ({
          execute: async () => ({
            body: {
              transactions: [{
                id: "test-transaction-id",
                interactionId: mockPaymentInteractionId,
                custom: {
                  fields: {
                    transactionComments: "Test transaction",
                  },
                },
              }],
            },
          }),
        }),
      }),
    }),
  },
}));

describe("novalnet-payment.service", () => {
  const opts: NovalnetPaymentServiceOptions = {
    ctCartService: {
      getCart: jest.fn(),
      addPayment: jest.fn(),
      getPaymentAmount: jest.fn(
        async ({ cart }: any) => cart.totalPrice
      ),
    } as unknown as NovalnetPaymentServiceOptions["ctCartService"],

    ctPaymentService: {
      getPayment: jest.fn(),
      createPayment: jest.fn(),
      updatePayment: jest.fn(),
    } as unknown as NovalnetPaymentServiceOptions["ctPaymentService"],
  };
  const paymentService: AbstractPaymentService = new NovalnetPaymentService(
    opts,
  );

  const novalnetPaymentService = paymentService as NovalnetPaymentService;
  beforeEach(() => {
    jest.setTimeout(10000);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });


  function setupPaymentCreate(type: PaymentMethodType) {
    const base = mockGetCartResult();

    const address = {
      country: "DE",
      city: "Berlin",
      postalCode: "10115",
      streetName: "Main Street, 10",
      firstName: "Test",
      lastName: "Customer",
    };

    const cart = {
      ...base,
      shippingAddress: address,
      billingAddress: address,
      customerEmail: "test@example.test",
      taxedPrice: {
        totalGross: base.totalPrice,
      },
    } as any;

    jest.spyOn(opts.ctCartService, "getCart")
      .mockResolvedValue(cart);

    jest.spyOn(opts.ctCartService, "addPayment")
      .mockResolvedValue(cart);

    jest.spyOn(opts.ctPaymentService, "createPayment")
      .mockResolvedValue(mockGetPaymentResult);

    jest.spyOn(opts.ctPaymentService, "updatePayment")
      .mockImplementation(async (payload: any) => {
        mockPaymentInteractionId =
          payload.transaction.interactionId;

        return mockGetPaymentResult;
      });

    jest.spyOn(opts.ctPaymentService, "getPayment")
      .mockImplementation(async () => ({
        ...mockGetPaymentResult,
        transactions: [{
          id: "test-transaction-id",
          interactionId: mockPaymentInteractionId,
          custom: {
            fields: {
              transactionComments: "Test transaction",
            },
          },
        }],
      } as any));

    jest.spyOn(
      FastifyContext,
      "getProcessorUrlFromContext"
    ).mockReturnValue("http://127.0.0.1");

    return jest.spyOn(
      novalnetPaymentService as any,
      "callNovalnet"
    ).mockResolvedValue({
      result: {
        status: "SUCCESS",
        status_text: "Successful",
      },
      transaction: {
        tid: "123456789",
        status: "CONFIRMED",
        status_code: 100,
        payment_type: type,
        amount: base.totalPrice.centAmount,
        currency: base.totalPrice.currencyCode,
        test_mode: "0",
      },
    });
  }

  test("getConfig preserves the SDK contract without mock fields", async () => {
    const result: ConfigResponse = await paymentService.config();
    expect(result).toEqual({});
  });

  test("getSupportedPaymentComponents", async () => {
    const result = await paymentService.getSupportedPaymentComponents();
    expect(result.components.map((component) => component.type)).toEqual(
      Object.values(PaymentMethodType),
    );
  });

  test("getStatus", async () => {
    const mockHealthCheckFunction: () => Promise<HealthCheckResult> =
      async () => {
        const result: HealthCheckResult = {
          name: "CoCo Permissions",
          status: "DOWN",
          message: "CoCo Permissions are not available",
          details: {},
        };
        return result;
      };

    jest
      .spyOn(StatusHandler, "healthCheckCommercetoolsPermissions")
      .mockReturnValue(mockHealthCheckFunction);
    const paymentService: AbstractPaymentService = new NovalnetPaymentService(
      opts,
    );
    const result: StatusResponse = await paymentService.status();

    expect(result?.status).toBeDefined();
    expect(result?.checks).toHaveLength(1);
    expect(result?.checks[0]?.name).toStrictEqual("CoCo Permissions");
    expect(result?.checks[0]?.status).toStrictEqual("DOWN");
    expect(result?.checks[0]?.details).toStrictEqual({});
    expect(result?.checks[0]?.message).toBeDefined();
  });

  test("cancelPayment rejects a captured payment", async () => {
    const modifyPaymentOpts: ModifyPayment = {
      paymentId: "dummy-paymentId",
      data: {
        actions: [
          {
            action: "cancelPayment",
          },
        ],
      },
    };
    jest
      .spyOn(opts.ctPaymentService, "getPayment")
      .mockReturnValue(Promise.resolve(mockGetPaymentResult));
    jest
      .spyOn(opts.ctPaymentService, "updatePayment")
      .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

    await expect(
      paymentService.modifyPayment(modifyPaymentOpts)
    ).rejects.toThrow("Authorization cannot be cancelled.");
  });

  test("create IDEAL payment", async () => {
    const createPaymentOpts: CreatePaymentRequest = {
      data: {
        paymentMethod: {
          type: PaymentMethodType.IDEAL,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    };
    const dispatch = setupPaymentCreate(PaymentMethodType.IDEAL);

    const result =
      await novalnetPaymentService.createDirectPayment(createPaymentOpts);
    expect(result?.paymentReference).toStrictEqual("123456");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((dispatch.mock.calls[0][1] as any).transaction.payment_type)
      .toBe(PaymentMethodType.IDEAL);
  });

  test("create invoice payment", async () => {
    const createPaymentOpts: CreatePaymentRequest = {
      data: {
        paymentMethod: {
          type: PaymentMethodType.INVOICE,
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    };
    const dispatch = setupPaymentCreate(PaymentMethodType.INVOICE);

    const result =
      await novalnetPaymentService.createDirectPayment(createPaymentOpts);
    expect(result?.paymentReference).toStrictEqual("123456");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((dispatch.mock.calls[0][1] as any).transaction.payment_type)
      .toBe(PaymentMethodType.INVOICE);
  });

  test("create prepayment payment successfully", async () => {
    const createPaymentOpts: CreatePaymentRequest = {
      data: {
        paymentMethod: {
          type: PaymentMethodType.PREPAYMENT,
          accHolder: "This is a test feild",
          accountNumber: "123456",
          routingNumber: "This is a test invoice",
        },
        paymentOutcome: PaymentOutcome.AUTHORIZED,
      },
    };
    const dispatch = setupPaymentCreate(PaymentMethodType.PREPAYMENT);

    const result =
      await novalnetPaymentService.createDirectPayment(createPaymentOpts);
    expect(result?.paymentReference).toStrictEqual("123456");
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect((dispatch.mock.calls[0][1] as any).transaction.payment_type)
      .toBe(PaymentMethodType.PREPAYMENT);
  });

  describe("handleTransaction", () => {
    test("should create the payment in CoCo and return it with a success state", async () => {
      const createPaymentOpts: TransactionDraftDTO = {
        cartId: "dd4b7669-698c-4175-8e4c-bed178abfed3",
        paymentInterface: "42251cfc-0660-4ab3-80f6-c32829aa7a8b",
        amount: {
          centAmount: 1000,
          currencyCode: "EUR",
        },
      };

      jest
        .spyOn(opts.ctCartService, "getCart")
        .mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(opts.ctPaymentService, "createPayment")
        .mockReturnValueOnce(Promise.resolve(mockGetPaymentResult));
      jest
        .spyOn(opts.ctCartService, "addPayment")
        .mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(opts.ctPaymentService, "updatePayment")
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
    });

    test("should create the payment in CoCo and return it with a failed state", async () => {
      const createPaymentOpts: TransactionDraftDTO = {
        cartId: "dd4b7669-698c-4175-8e4c-bed178abfed3",
        paymentInterface: "42251cfc-0660-4ab3-80f6-c32829aa7a8b",
        amount: {
          centAmount: 10000,
          currencyCode: "EUR",
        },
      };

      jest
        .spyOn(opts.ctCartService, "getCart")
        .mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(opts.ctPaymentService, "createPayment")
        .mockReturnValueOnce(Promise.resolve(mockGetPaymentResult));
      jest
        .spyOn(opts.ctCartService, "addPayment")
        .mockReturnValueOnce(Promise.resolve(mockGetCartResult()));
      jest
        .spyOn(opts.ctPaymentService, "updatePayment")
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
    });
  });

  describe("reversePayment", () => {
    test("it should fail because there are no transactions to revert", async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: "dummy-paymentId",
        data: {
          actions: [
            {
              action: "reversePayment",
            },
          ],
        },
      };
      jest
        .spyOn(opts.ctPaymentService, "getPayment")
        .mockReturnValue(
          Promise.resolve(mockGetPaymentResultWithoutTransactions),
        );
      jest
        .spyOn(opts.ctPaymentService, "updatePayment")
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));
      jest
        .spyOn(opts.ctPaymentService, "updatePayment")
        .mockReturnValue(Promise.resolve(mockUpdatePaymentResult));

      const result = paymentService.modifyPayment(modifyPaymentOpts);
      await expect(result).rejects.toThrow(
        "Authorization cannot be cancelled.",
      );
    });

    test("reversePayment rejects a captured transaction missing the PSP reference", async () => {
      const modifyPaymentOpts: ModifyPayment = {
        paymentId: "dummy-paymentId",
        data: {
          actions: [
            {
              action: "reversePayment",
            },
          ],
        },
      };
      jest
        .spyOn(opts.ctPaymentService, "getPayment")
        .mockReturnValue(Promise.resolve(mockGetPaymentResult));
      jest
        .spyOn(opts.ctPaymentService, "updatePayment")
        .mockReturnValue(
          Promise.resolve(mockUpdatePaymentResultWithRefundTransaction),
        );

      await expect(
        paymentService.modifyPayment(modifyPaymentOpts)
      ).rejects.toThrow("Original payment transaction not found.");
    });
  });
});
