import { NovalnetDropinBuilder } from "../src/components/payment-methods/dropin/dropin";

class ElementStub {
  children: ElementStub[] = [];
  parent?: ElementStub;
  id = "";
  type = "";
  name = "";
  value = "";
  className = "";
  textContent = "";
  hidden = false;
  checked = false;
  attrs: Record<string, string> = {};
  handlers: Record<string, () => void> = {};
  append(...children: ElementStub[]) {
    for (const child of children) { child.parent = this; this.children.push(child); }
  }
  appendChild(child: ElementStub) { this.append(child); return child; }
  setAttribute(key: string, value: string) { this.attrs[key] = value; }
  addEventListener(event: string, handler: () => void) { this.handlers[event] = handler; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = undefined;
  }
  all(): ElementStub[] { return this.children.flatMap((c) => [c, ...c.all()]); }
}

let container: ElementStub;
let created: string[];
let submitted: string[];
let onClick: jest.Mock;
let onReady: jest.Mock;
let factory: jest.Mock;

beforeEach(() => {
  container = new ElementStub();
  created = [];
  submitted = [];
  onClick = jest.fn(async () => undefined);
  onReady = jest.fn(async () => undefined);
  factory = jest.fn(async (method: string) => ({
    componentHasSubmit: true,
    build: ({ showPayButton }: { showPayButton?: boolean }) => {
      expect(showPayButton).toBe(false);
      created.push(method);
      return {
        mount: async (_selector: string) => undefined,
        submit: async () => { submitted.push(method); },
      };
    },
  }));
  (globalThis as any).document = {
    querySelector: (selector: string) => selector === "#mount" ? container : null,
    createElement: () => new ElementStub(),
  };
});

test("renders one configured method and calls ready callback", async () => {
  const dropin = new NovalnetDropinBuilder(["invoice", "paypal"], factory, "en")
    .build({ showPayButton: true, onDropinReady: onReady, onPayButtonClick: onClick });
  await dropin.mount("#mount");
  expect(created).toEqual(["invoice"]);
  expect(container.all().some((el) => el.textContent === "Invoice")).toBe(true);
  expect(container.all().some((el) => el.textContent === "PayPal")).toBe(true);
  expect(onReady).toHaveBeenCalledTimes(1);
  await dropin.submit();
  expect(submitted).toEqual(["invoice"]);
  expect(onClick).toHaveBeenCalledTimes(1);
});

test("switches methods without charging the previous method", async () => {
  const dropin = new NovalnetDropinBuilder(["invoice", "paypal"], factory, "de")
    .build({ onPayButtonClick: onClick });
  await dropin.mount("#mount");
  const paypalRadio = container.all().find((el) => el.type === "radio" && el.value === "paypal")!;
  paypalRadio.checked = true;
  paypalRadio.handlers.change();
  // Wait for the asynchronous method-builder and mount path.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await dropin.submit();
  expect(submitted).toEqual(["paypal"]);
  expect(onClick).toHaveBeenCalledTimes(1);
  await dropin.remove();
  expect(container.children).toHaveLength(0);
});
