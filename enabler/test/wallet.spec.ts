import { GooglePayBuilder, ApplePayBuilder } from "../src/components/payment-methods/wallet/wallet";

class StubElement {
  id = "";
  className = "";
  textContent = "";
  children: StubElement[] = [];
  parent: StubElement | null = null;
  appendChild(el: StubElement) { el.parent = this; this.children.push(el); return el; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((e) => e !== this); }
}

const config = {
  clientKey: "public-client-key", amount: 1299, currency: "EUR",
  merchantName: "Demo Shop", countryCode: "DE", environment: "SANDBOX",
};
let sdkIntent: any;
let sdkButtonMounted = false;
let mount: StubElement;
let onComplete: jest.Mock;
let onError: jest.Mock;
let fetchMock: jest.Mock;
let available = true;

beforeEach(() => {
  sdkIntent = null;
  sdkButtonMounted = false;
  available = true;
  mount = new StubElement();
  onComplete = jest.fn();
  onError = jest.fn();
  (globalThis as any).window = {
    location: { pathname: "/en/checkout", origin: "https://merchant.example" },
    NovalnetPayment: () => ({ createPaymentObject: () => ({
      setPaymentIntent: (value: any) => { sdkIntent = value; },
      isPaymentMethodAvailable: (callback: (result: boolean) => void) => callback(available),
      addPaymentButton: () => { sdkButtonMounted = true; },
    }) }),
  };
  (globalThis as any).document = {
    documentElement: { lang: "en" },
    querySelector: (sel: string) => sel === "#wallet" ? mount : null,
    createElement: () => new StubElement(),
  };
  fetchMock = jest.fn(async (url: string) => {
    if (url.includes("/walletConfig")) return { ok: true, json: async () => config };
    if (url.includes("/directPayment")) return {
      ok: true, json: async () => ({ paymentReference: "ct-payment-123", transactionStatus: "CONFIRMED" }),
    };
    throw new Error("Unexpected URL " + url);
  });
  (globalThis as any).fetch = fetchMock;
});

for (const [name, Builder, type] of [
  ["Google Pay", GooglePayBuilder, "GOOGLEPAY"],
  ["Apple Pay", ApplePayBuilder, "APPLEPAY"],
] as const) {
  test(`${name}: mounts Novalnet SDK native button and submits token to server`, async () => {
    const component = new Builder({
      sessionId: "session-test", processorUrl: "https://processor.example",
      locale: "en", onComplete, onError,
    }).build({ showPayButton: false });
    await component.mount("#wallet");
    expect(sdkButtonMounted).toBe(true);
    expect(sdkIntent.paymentIntent.transaction.paymentMethod).toBe(type);
    expect(sdkIntent.paymentIntent.transaction.amount).toBe(1299);
    expect(sdkIntent.paymentIntent.transaction.currency).toBe("EUR");
    expect(sdkIntent.clientKey).toBe("public-client-key");
    const callback = jest.fn();
    sdkIntent.paymentIntent.callbacks.onProcessCompletion({
      result: { status: "SUCCESS" }, transaction: { token: "provider-wallet-token-123" },
    }, callback);
    await new Promise((r) => setTimeout(r, 0));
    expect(callback).toHaveBeenCalledWith({ status: "SUCCESS", statusText: "" });
    const paymentCall = fetchMock.mock.calls.find((call) => String(call[0]).includes("/directPayment"));
    const request = JSON.parse(paymentCall![1].body);
    expect(request.paymentMethod).toEqual({
      type, walletToken: "provider-wallet-token-123",
      walletAmount: 1299, walletCurrency: "EUR",
    });
    expect(request).not.toHaveProperty("amount");
    expect(onComplete).toHaveBeenCalledWith({ isSuccess: true, paymentReference: "ct-payment-123" });
    expect(onError).not.toHaveBeenCalled();
  });
}

test("unsupported device does not render an Apple Pay button", async () => {
  available = false;
  const component = new ApplePayBuilder({
    sessionId: "test", processorUrl: "https://processor.example", onComplete, onError,
  }).build({ showPayButton: false });
  await component.mount("#wallet");
  expect(sdkButtonMounted).toBe(false);
  expect(mount.children[0].textContent).toContain("not available");
});
