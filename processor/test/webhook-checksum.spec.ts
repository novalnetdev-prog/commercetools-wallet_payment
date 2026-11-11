import crypto from "crypto";
import * as Config from "../src/config/config";
import { NovalnetPaymentService } from "../src/services/novalnet-payment.service";


jest.mock("../src/payment-sdk", () => ({ paymentSDK: {}, appLogger: {} }));
jest.mock("../src/utils/ct-client", () => ({ projectApiRoot: {} }));
jest.mock("../src/libs/logger", () => ({
  log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const accessKey = "non-production-test-access-key";
const paymentService = new NovalnetPaymentService({
  ctCartService: {} as any,
  ctPaymentService: {} as any,
});

function sampleWebhook() {
  const payload = {
    event: { tid: "123456789", type: "PAYMENT", checksum: "" },
    result: { status: "SUCCESS" },
    transaction: { amount: 2500, currency: "EUR" },
  };
  const signed = `${payload.event.tid}${payload.event.type}${payload.result.status}` +
    `${payload.transaction.amount}${payload.transaction.currency}` +
    accessKey.split("").reverse().join("");
  payload.event.checksum = crypto.createHash("sha256").update(signed).digest("hex");
  return payload;
}

beforeEach(() => {
  jest.spyOn(Config, "getConfig").mockReturnValue({ novalnetPrivateKey: accessKey } as any);
});
afterEach(() => jest.restoreAllMocks());

test("accepts a correctly signed Novalnet webhook", async () => {
  await expect((paymentService as any).validateChecksum(sampleWebhook()))
    .resolves.toBeUndefined();
});

const tamperCases: Array<[string, (webhook: ReturnType<typeof sampleWebhook>) => void]> = [
  ["wrong checksum", (webhook: any) => { webhook.event.checksum = "invalid"; }],
  ["changed transaction ID", (webhook: any) => { webhook.event.tid = "999"; }],
  ["changed event type", (webhook: any) => { webhook.event.type = "CREDIT"; }],
  ["changed result", (webhook: any) => { webhook.result.status = "FAILURE"; }],
  ["changed amount", (webhook: any) => { webhook.transaction.amount += 1; }],
  ["changed currency", (webhook: any) => { webhook.transaction.currency = "USD"; }],
];

test.each(tamperCases)("rejects webhook with %s", async (_name, change) => {
  const webhook = sampleWebhook();
  change(webhook);
  await expect((paymentService as any).validateChecksum(webhook))
    .rejects.toThrow("Checksum validation failed");
});
