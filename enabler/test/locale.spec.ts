import { BaseComponent } from "../src/components/base";
import { PaymentMethod } from "../src/payment-enabler/payment-enabler";

class LocaleProbe extends BaseComponent {
  constructor(locale?: string) {
    super(
      PaymentMethod.creditcard,
      {
        processorUrl: "https://processor.example",
        sessionId: "session",
        locale,
        onComplete: () => {},
        onError: () => {},
      },
      {},
    );
  }
  mount(_selector: string): void {}
  submit(): void {}
  language(): "en" | "de" { return this.getLanguage(); }
}

describe("enabler storefront locales", () => {
  beforeEach(() => {
    (globalThis as any).window = { location: { pathname: "/" } };
    (globalThis as any).document = { documentElement: { lang: "en" } };
  });
  afterEach(() => {
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  test.each([
    ["en", "en"],
    ["en-us", "en"],
    ["de", "de"],
    ["de-de", "de"],
    ["fr-FR", "en"],
  ] as const)("explicit locale %s becomes %s", (input, expected) => {
    expect(new LocaleProbe(input).language()).toBe(expected);
  });

  test.each([
    ["/en-us/checkout", "en"],
    ["/de-de/checkout", "de"],
    ["/checkout", "en"],
  ] as const)("URL %s resolves to %s", (pathname, expected) => {
    (globalThis as any).window.location.pathname = pathname;
    expect(new LocaleProbe().language()).toBe(expected);
  });

  test("uses the html locale as a fallback and defaults to English", () => {
    (globalThis as any).document.documentElement.lang = "de-DE";
    expect(new LocaleProbe().language()).toBe("de");
    (globalThis as any).document.documentElement.lang = "";
    expect(new LocaleProbe().language()).toBe("en");
  });
});
