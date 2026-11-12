import { PaymentFeatures } from "../src/components/payment-methods/payment-features";
// Minimal DOM for the helper's owned controls; provider iframe/Utility behavior is not mocked as a browser test.
class ElementStub {
  children: any[] = [];
  style = { display: "" };
  parentElement?: ElementStub;
  type = "";
  name = "";
  value = "";
  checked = false;
  disabled = false;
  required = true;
  textContent = "";
  className = "";
  innerHTML = "";
  attributes: Record<string, string> = {};
  handlers: Record<string, (event?: any) => void> = {};
  append(...nodes: any[]) {
    this.children.push(...nodes);
    for (const node of nodes)
      if (typeof node === "object") node.parentElement = this;
  }
  appendChild(node: any) {
    this.append(node);
    return node;
  }
  prepend(node: any) {
    this.children.unshift(node);
    node.parentElement = this;
  }
  after(node: any) {
    this.parentElement?.append(node);
  }
  addEventListener(type: string, fn: (event?: any) => void) {
    this.handlers[type] = fn;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  remove() {
    if (this.parentElement) {
      this.parentElement.children = this.parentElement.children.filter((node) => node !== this);
      this.parentElement = undefined;
    }
  }
  replaceWith(node: any) {
    if (!this.parentElement) return;
    const parent = this.parentElement;
    const index = parent.children.indexOf(this);
    parent.children[index] = node;
    node.parentElement = parent;
    this.parentElement = undefined;
  }
  all(): any[] {
    return this.children.flatMap((node) =>
      typeof node === "object" ? [node, ...node.all()] : [],
    );
  }
  querySelector(selector: string): any {
    return selector === "input:checked"
      ? this.all().find((node) => node.type === "radio" && node.checked)
      : undefined;
  }
}
let fields: Record<string, ElementStub>;
let container: ElementStub;
let reply: any;
beforeEach(() => {
  container = new ElementStub();
  fields = {};
  for (const name of ["#bank", "#dob"]) {
    const field = new ElementStub();
    container.append(field);
    const input = new ElementStub();
    field.append(input);
    fields[name] = name === "#dob" ? input : field;
  }
  container.querySelector = (selector) => fields[selector];
  (globalThis as any).document = {
    createElement: () => new ElementStub(),
    createTextNode: (text: string) => text,
    querySelector: () => null,
  };
  (globalThis as any).fetch = jest.fn(async () => ({
    ok: true,
    json: async () => reply,
  }));
});
const mount = (helper: PaymentFeatures, locale: "en" | "de" = "en") =>
  helper.mount({
    container: container as any,
    processorUrl: "https://processor.example",
    sessionId: "session",
    type: "GUARANTEED_DIRECT_DEBIT_SEPA",
    locale,
    fields: ["#bank"],
    dob: "#dob",
  });
test("disabled one-click creates no consent controls; B2B only hides DOB when server confirms it", async () => {
  reply = { oneClick: false, business: false, savedPayments: [] };
  const h = new PaymentFeatures();
  await mount(h);
  expect(h.business).toBe(false);
  expect(fields["#dob"].disabled).toBe(false);
  expect(container.all().filter((x) => x.type === "checkbox")).toHaveLength(0);
  reply.business = true;
  await mount(new PaymentFeatures());
  expect(fields["#dob"].disabled).toBe(true);
  expect(fields["#dob"].parentElement!.style.display).toBe("none");
});
test("consent starts unchecked and sends create request only after deliberate selection", async () => {
  reply = { oneClick: true, business: false, savedPayments: [] };
  const h = new PaymentFeatures();
  await mount(h, "de");
  expect(h.paymentFields).toEqual({});
  const check = container.all().find((x) => x.type === "checkbox");
  check.checked = true;
  expect(h.paymentFields).toEqual({ savePayment: true });
  expect(check.parentElement.children).toContain(
    " Speichern für zukünftige Einkäufe",
  );
});
test("latest three saved options plus new details; selecting new toggles fields and consent", async () => {
  reply = {
    oneClick: true,
    business: false,
    savedPayments: Array.from({ length: 4 }, (_, i) => ({
      id: "id" + i,
      label: "IBAN •••• 123" + i,
    })),
  };
  const h = new PaymentFeatures();
  await mount(h);
  const radios = container.all().filter((x) => x.type === "radio");
  expect(radios).toHaveLength(4);
  expect(h.paymentFields).toEqual({ savedPaymentId: "id0" });
  expect(fields["#bank"].style.display).toBe("none");
  radios.forEach((x) => (x.checked = false));
  radios[3].checked = true;
  radios[3].handlers.change();
  expect(h.paymentFields).toEqual({});
  expect(fields["#bank"].style.display).toBe("");
  const check = container.all().find((x) => x.type === "checkbox");
  expect(check.parentElement.style.display).toBe("block");
  check.checked = true;
  radios[3].checked = false;
  radios[1].checked = true;
  radios[1].handlers.change();
  expect(check.checked).toBe(false);
  expect(h.paymentFields).toEqual({ savedPaymentId: "id1" });
});
test("request uses active Session and response labels are inserted as text", async () => {
  reply = {
    oneClick: true,
    business: false,
    savedPayments: [{ id: "id", label: "<img src=x onerror=alert(1)>" }],
  };
  await mount(new PaymentFeatures());
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining(
      "/paymentFeatures?paymentMethod=GUARANTEED_DIRECT_DEBIT_SEPA",
    ),
    { headers: { "X-Session-Id": "session" }, cache: "no-store" },
  );
  const maliciousLabel = "<img src=x onerror=alert(1)>";

  expect(
    container
      .all()
      .some((x) => x.textContent === maliciousLabel),
  ).toBe(true);

  expect(
    container
      .all()
      .some((x) => x.innerHTML.includes("<img")),
  ).toBe(false);
});
test("settings failure is not treated as permission to save or skip DOB", async () => {
  (fetch as jest.Mock).mockResolvedValueOnce({ ok: false });
  const h = new PaymentFeatures();
  await expect(mount(h)).rejects.toThrow();
  expect(h.paymentFields).toEqual({});
  expect(h.business).toBe(false);
});

test("reuses native commercetools classes when the payment radio is already rendered", async () => {
  reply = {
    oneClick: true, business: false,
    savedPayments: [{ id: "stored", label: "Visa •••• 1234" }],
  };
  const outer = new ElementStub();
  outer.className = "ct-native-layout";
  const inner = new ElementStub();
  inner.className = "ct-native-inner";
  const nativeRadio = new ElementStub();
  nativeRadio.className = "ct-native-radio";
  const nativeText = new ElementStub();
  nativeText.className = "ct-native-text";
  inner.querySelector = (selector: string) =>
    selector === ":scope > span > div" ? nativeText : undefined;
  inner.append(nativeRadio);
  outer.append(inner);
  (globalThis as any).document.querySelector = () => nativeRadio;

  const features = new PaymentFeatures();
  await mount(features);
  const radios = container.all().filter((node) => node.type === "radio");
  expect(radios).toHaveLength(2); // saved card plus original new-details option
  expect(radios.every((radio) => radio.className.includes("ct-native-radio")))
    .toBe(true);
  expect(features.paymentFields).toEqual({ savedPaymentId: "stored" });
  expect(fields["#bank"].style.display).toBe("none");
});

test("adopts commercetools classes if its native radio appears after initial render", async () => {
  reply = {
    oneClick: true, business: false,
    savedPayments: [{ id: "stored", label: "Visa •••• 5678" }],
  };
  let onMutation: (() => void) | undefined;
  (globalThis as any).document.documentElement = new ElementStub();
  (globalThis as any).MutationObserver = class {
    constructor(callback: () => void) { onMutation = callback; }
    observe() {}
    disconnect() {}
  };

  try {
    const features = new PaymentFeatures();
    await mount(features);
    const radios = container.all().filter((node) => node.type === "radio");
    expect(radios).toHaveLength(2);
    expect(onMutation).toBeDefined();
    expect(radios[0].className).not.toContain("ct-native-radio");
    const outer = new ElementStub();
    outer.className = "ct-native-layout";
    const inner = new ElementStub();
    inner.className = "ct-native-inner";
    const nativeRadio = new ElementStub();
    nativeRadio.className = "ct-native-radio";
    inner.append(nativeRadio);
    outer.append(inner);
    (globalThis as any).document.querySelector = () => nativeRadio;
    onMutation!();
    expect(radios.every((radio) => radio.className.includes("ct-native-radio")))
      .toBe(true);
    expect(features.paymentFields).toEqual({ savedPaymentId: "stored" });
    expect(fields["#bank"].style.display).toBe("none");
  } finally {
    delete (globalThis as any).MutationObserver;
  }
});

test("deleting tokens reveals fourth token and ultimately shows new payment fields", async () => {
  reply = {
    oneClick: true, business: false,
    savedPayments: Array.from({ length: 4 }, (_, i) => ({
      id: `id${i}`, label: `Visa •••• ${i}`,
    })),
  };
  (globalThis as any).fetch = jest.fn(async (url: string, opts?: { body?: string }) => {
    if (url.endsWith("/deleteSavedPayment")) {
      const { savedPaymentId } = JSON.parse(opts!.body!);
      reply.savedPayments = reply.savedPayments.filter((p) => p.id !== savedPaymentId);
    }
    return { ok: true, json: async () => reply };
  });

  const features = new PaymentFeatures();
  await mount(features);
  const getRadios = () => container.all().filter((node) => node.type === "radio");
  const getDeletes = () => container.all().filter((node) => node.type === "button");
  expect(getRadios().map((radio) => radio.value)).toEqual(["id0", "id1", "id2", ""]);
  await getDeletes()[0].handlers.click({ preventDefault() {}, stopPropagation() {} });
  expect(getRadios().map((radio) => radio.value)).toEqual(["id1", "id2", "id3", ""]);

  while (getDeletes().length) {
    await getDeletes()[0].handlers.click({ preventDefault() {}, stopPropagation() {} });
  }
  expect(getRadios()).toHaveLength(0);
  expect(features.paymentFields).toEqual({});
  expect(fields["#bank"].style.display).toBe("");
});

test("keeps the new-details selection when another saved token is deleted", async () => {
  reply = {
    oneClick: true, business: false,
    savedPayments: [{ id: "id1", label: "Visa 1" }, { id: "id2", label: "Visa 2" }],
  };
  (globalThis as any).fetch = jest.fn(async (url: string, opts?: { body?: string }) => {
    if (url.endsWith("/deleteSavedPayment")) {
      const { savedPaymentId } = JSON.parse(opts!.body!);
      reply.savedPayments = reply.savedPayments.filter((p) => p.id !== savedPaymentId);
    }
    return { ok: true, json: async () => reply };
  });
  const features = new PaymentFeatures();
  await mount(features);
  const radios = container.all().filter((node) => node.type === "radio");
  radios.forEach((radio) => (radio.checked = false));
  radios[2].checked = true;
  radios[2].handlers.change();
  expect(fields["#bank"].style.display).toBe("");
  const remove = container.all().find((node) => node.type === "button");
  await remove.handlers.click({ preventDefault() {}, stopPropagation() {} });
  expect(features.paymentFields).toEqual({});
  expect(fields["#bank"].style.display).toBe("");
  const newDetails = container.all().find((node) => node.type === "radio" && node.value === "");
  expect(newDetails.checked).toBe(true);
});
