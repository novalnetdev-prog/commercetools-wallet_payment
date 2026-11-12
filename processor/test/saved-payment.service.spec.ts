import {
  SavedPaymentService,
  isBusinessGuarantee,
  oneClickEnabled,
} from "../src/services/saved-payment.service";
import { config } from "../src/config/config";
jest.mock("../src/utils/ct-client", () => ({ projectApiRoot: {} }));
function store() {
  const records = new Map<string, any>();
  let conflict = false;
  const api = {
    customObjects: () => ({
      withContainerAndKey: ({ container, key }: any) => ({
        get: () => ({
          execute: async () => {
            const result = records.get(container + key);
            if (!result) throw { statusCode: 404 };
            return { body: JSON.parse(JSON.stringify(result)) };
          },
        }),
      }),
      post: ({ body }: any) => ({
        execute: async () => {
          if (conflict) {
            conflict = false;
            throw { statusCode: 409 };
          }
          const result = {
            value: body.value,
            version: (records.get(body.container + body.key)?.version ?? 0) + 1,
          };
          records.set(body.container + body.key, result);
          return { body: result };
        },
      }),
    }),
  };
  return {
    api,
    records,
    failNextWrite: () => {
      conflict = true;
    },
  };
}
const sepa = "DIRECT_DEBIT_SEPA";
const gsepa = "GUARANTEED_DIRECT_DEBIT_SEPA";
function response(
  token: string,
  type = sepa,
  status = "PENDING",
  result = "SUCCESS",
) {
  return {
    result: { status: result },
    transaction: {
      status,
      payment_type: type,
      test_mode: 0,
      payment_data: {
        token,
        iban: "DE12345678901234567890",
        card_number: "4111111111111111",
        card_brand: "Visa",
      },
    },
  };
}
beforeEach(() => {
  Object.assign(config, {
    novalnet_DIRECT_DEBIT_SEPA_OneClickShopping: "1",
    novalnet_GUARANTEED_DIRECT_DEBIT_SEPA_OneClickShopping: "1",
    novalnet_CREDITCARD_OneClickShopping: "1",
    novalnet_DIRECT_DEBIT_SEPA_TestMode: "0",
    novalnet_GUARANTEED_DIRECT_DEBIT_SEPA_TestMode: "0",
    novalnet_CREDITCARD_TestMode: "0",
  });
});
test.each(["GUARANTEED_INVOICE", gsepa])(
  "B2B requires enabled flag and nonempty address.company: %s",
  (type) => {
    expect(
      isBusinessGuarantee(type, "ACME GmbH", {
        [`novalnet_${type}_Allowb2bCustomers`]: "1",
      }),
    ).toBe(true);
    expect(
      isBusinessGuarantee(type, "  ", {
        [`novalnet_${type}_Allowb2bCustomers`]: "1",
      }),
    ).toBe(false);
    expect(
      isBusinessGuarantee(type, "ACME GmbH", {
        [`novalnet_${type}_Allowb2bCustomers`]: "0",
      }),
    ).toBe(false);
    expect(
      isBusinessGuarantee(type, undefined, {
        [`novalnet_${type}_Allowb2bCustomers`]: "1",
      }),
    ).toBe(false);
  },
);
test("unrelated methods cannot enable B2B or one-click", () => {
  expect(
    isBusinessGuarantee(sepa, "ACME", {
      [`novalnet_${sepa}_Allowb2bCustomers`]: "1",
    }),
  ).toBe(false);
  expect(
    oneClickEnabled("INVOICE", { novalnet_INVOICE_OneClickShopping: "1" }),
  ).toBe(false);
});
test("no consent, unchecked consent, disabled methods and guests never save a token", async () => {
  const { api, records } = store();
  const service = new SavedPaymentService(api);
  await service.saveResponse("p", "r", response("token"));
  await service.consent("p", "r", "customer", sepa, false);
  await service.consent("p", "r", undefined, sepa, true);
  config.novalnet_DIRECT_DEBIT_SEPA_OneClickShopping = "0";
  await service.consent("p", "r", "customer", sepa, true);
  expect(records.size).toBe(0);
  expect(await service.list(undefined, sepa)).toEqual([]);
});
test("list exposes stored IBAN in label but not token; resolve requires correct owner and enabled feature", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("p", "r", "customer-a", sepa, true);
  await service.saveResponse("p", "r", response("secret-token"));
  const list = await service.list("customer-a", sepa);
  expect(list).toHaveLength(1);
  expect(list[0].label).toBe("IBAN DE12345678901234567890");
  expect(JSON.stringify(list)).not.toContain("secret-token");
  expect(await service.resolve("customer-a", sepa, list[0].id)).toBe(
    "secret-token",
  );
  await expect(
    service.resolve("customer-b", sepa, list[0].id),
  ).rejects.toThrow();
  await expect(service.resolve(undefined, sepa, list[0].id)).rejects.toThrow();
  config.novalnet_DIRECT_DEBIT_SEPA_OneClickShopping = "0";
  await expect(
    service.resolve("customer-a", sepa, list[0].id),
  ).rejects.toThrow();
});
test("keeps latest three distinct entries; duplicate callbacks do not repeat or reorder them", async () => {
  const { api, records } = store();
  const service = new SavedPaymentService(api);
  for (let i = 0; i < 4; i++) {
    await service.consent("p" + i, "r" + i, "customer", sepa, true);
    await service.saveResponse("p" + i, "r" + i, response("token" + i));
  }
  const list = await service.list("customer", sepa);
  expect(list).toHaveLength(3);
  expect(await service.resolve("customer", sepa, list[0].id)).toBe("token3");
  await service.saveResponse("p2", "r2", response("token2"));
  expect(await service.list("customer", sepa)).toEqual(list);
  expect(JSON.stringify([...records.values()])).not.toContain(
    "4111111111111111",
  );
});
test("SEPA variants share saved accounts; cards and live/test environments remain separate", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("p", "r", "customer", sepa, true);
  await service.saveResponse("p", "r", response("token"));
  expect(await service.list("customer", gsepa)).toHaveLength(1);
  expect(await service.list("customer", "CREDITCARD")).toEqual([]);
  config.novalnet_DIRECT_DEBIT_SEPA_TestMode = "1";
  expect(await service.list("customer", sepa)).toEqual([]);
});
test.each([
  response("token", sepa, "FAILURE", "FAILURE"),
  response("token", "CREDITCARD", "CONFIRMED"),
])("rejects unsuccessful provider result or mismatched payment type", async (reply) => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("p", "r", "customer", sepa, true);
  await service.saveResponse("p", "r", reply);
  expect(await service.list("customer", sepa)).toEqual([]);
});

test("provider test_mode does not override the configured token scope (existing behavior)", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);

  const reply = response("token");
  reply.transaction.test_mode = 1;

  await service.consent("p", "r", "customer", sepa, true);
  await service.saveResponse("p", "r", reply);

  const saved = await service.list("customer", sepa);

  expect(saved).toHaveLength(1);
  expect(await service.resolve("customer", sepa, saved[0].id))
    .toBe("token");

  config.novalnet_DIRECT_DEBIT_SEPA_TestMode = "1";
  expect(await service.list("customer", sepa)).toEqual([]);
});

test("mismatched reference cannot save; valid duplicate/conflicted write converges", async () => {
  const { api, failNextWrite } = store();
  const service = new SavedPaymentService(api);
  await service.consent("p", "r", "customer", sepa, true);
  await service.saveResponse("p", "wrong", response("token"));
  expect(await service.list("customer", sepa)).toEqual([]);
  failNextWrite();
  await service.saveResponse("p", "r", response("token"));
  expect(await service.list("customer", sepa)).toHaveLength(1);
});
test("3DS card token is saved only after a successful final result", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("p", "r", "customer", "CREDITCARD", true);
  await service.saveResponse(
    "p",
    "r",
    response("card-token", "CREDITCARD", "PENDING"),
  );
  expect(await service.list("customer", "CREDITCARD")).toEqual([]);
  await service.saveResponse(
    "p",
    "r",
    response("card-token", "CREDITCARD", "ON_HOLD"),
  );
  const list = await service.list("customer", "CREDITCARD");
  expect(list).toHaveLength(1);
  expect(list[0].label).toBe("Visa ending in 1111");
});
test("3DS token returned before redirect is saved only for a verified final matching TID", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("p", "r", "customer", "CREDITCARD", true);
  const initial: any = response("3ds-token", "CREDITCARD", "PENDING");
  initial.result.redirect_url = "https://provider.example/3ds";
  initial.transaction.tid = "123456789";
  await service.rememberRedirect("p", "r", initial);
  expect(await service.list("customer", "CREDITCARD")).toEqual([]);
  const final: any = response("", "CREDITCARD", "CONFIRMED");
  delete final.transaction.payment_data;
  final.transaction.tid = "wrong";
  await service.saveResponse("p", "r", final);
  expect(await service.list("customer", "CREDITCARD")).toEqual([]);
  final.transaction.tid = "123456789";
  await service.saveResponse("p", "r", final);
  expect(await service.list("customer", "CREDITCARD")).toHaveLength(1);
});
test("deleting one of the latest three reveals the next previously saved token", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  for (let i = 0; i < 4; i++) {
    await service.consent("p" + i, "r" + i, "customer", sepa, true);
    await service.saveResponse("p" + i, "r" + i, response("token" + i));
  }

  let list = await service.list("customer", sepa);
  expect(list).toHaveLength(3);
  expect(await service.resolve("customer", sepa, list[0].id)).toBe("token3");

  await service.remove("customer", sepa, list[0].id);

  list = await service.list("customer", sepa);
  expect(list).toHaveLength(3);
  expect(await service.resolve("customer", sepa, list[0].id)).toBe("token2");
  expect(await service.resolve("customer", sepa, list[2].id)).toBe("token0");
});

test("replayed old confirmation cannot reinsert an entry already evicted from latest three", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  for (let i = 0; i < 4; i++) {
    await service.consent("p" + i, "r" + i, "customer", sepa, true);
    await service.saveResponse("p" + i, "r" + i, response("token" + i));
  }
  const list = await service.list("customer", sepa);
  await service.saveResponse("p0", "r0", response("token0"));
  expect(await service.list("customer", sepa)).toEqual(list);
});
test("final 3DS proof containing only token keeps masked metadata from initial response", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("p", "r", "customer", "CREDITCARD", true);
  const initial: any = response("card-token", "CREDITCARD", "PENDING");
  initial.result.redirect_url = "https://provider.example/3ds";
  initial.transaction.tid = "123";
  await service.rememberRedirect("p", "r", initial);
  const final: any = response("card-token", "CREDITCARD", "ON_HOLD");
  final.transaction.payment_data = { token: "card-token" };
  final.transaction.tid = "123";
  await service.saveResponse("p", "r", final);
  expect((await service.list("customer", "CREDITCARD"))[0].label).toBe(
    "Visa ending in 1111",
  );
});


test("saved card label includes brand, last four digits and expiry in English", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("card-en", "r", "customer", "CREDITCARD", true, "en-US");
  const card: any = response("card-token", "CREDITCARD", "CONFIRMED");
  card.transaction.payment_data = {
    ...card.transaction.payment_data,
    card_brand: "VISA",
    last_four: "0000",
    card_expiry_month: 2,
    card_expiry_year: 2027,
  };
  await service.saveResponse("card-en", "r", card);
  expect((await service.list("customer", "CREDITCARD"))[0].label).toBe(
    "VISA ending in 0000 (expires 02/2027)",
  );
});

test("saved card label uses German wording when checkout language is German", async () => {
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("card-de", "r", "customer", "CREDITCARD", true, "de-DE");
  const card: any = response("card-token-de", "CREDITCARD", "CONFIRMED");
  card.transaction.payment_data = {
    ...card.transaction.payment_data,
    card_brand: "VISA",
    last_four: "0000",
    card_expiry_month: 2,
    card_expiry_year: 2027,
  };
  await service.saveResponse("card-de", "r", card);
  expect((await service.list("customer", "CREDITCARD", "de-DE"))[0].label).toBe(
    "VISA mit Endziffern 0000 (gültig bis 02/2027)",
  );
});

test("saved ACH label identifies the account number", async () => {
  config.novalnet_DIRECT_DEBIT_ACH_OneClickShopping = "1";
  const { api } = store();
  const service = new SavedPaymentService(api);
  await service.consent("ach", "r", "customer", "DIRECT_DEBIT_ACH", true, "en");
  const ach: any = response("ach-token", "DIRECT_DEBIT_ACH", "CONFIRMED");
  ach.transaction.payment_data = { token: "ach-token", account_number: "123456789" };
  await service.saveResponse("ach", "r", ach);
  expect((await service.list("customer", "DIRECT_DEBIT_ACH"))[0].label).toBe(
    "ACCOUNT NO 123456789",
  );
});
