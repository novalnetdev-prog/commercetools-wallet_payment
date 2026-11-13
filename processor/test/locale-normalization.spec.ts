import { normalizeLocale } from "../src/i18n";

describe("storefront locale normalization", () => {
  test.each([
    ["en", "en"],
    ["en-us", "en"],
    ["en-US", "en"],
    ["de", "de"],
    ["de-de", "de"],
    ["de-DE", "de"],
    ["DE_DE", "de"],
    [" de-DE ", "de"],
    ["fr-FR", "en"],
    ["deutsch", "en"],
    ["", "en"],
    [null, "en"],
    [undefined, "en"],
  ] as const)("maps %s to %s", (input, expected) => {
    expect(normalizeLocale(input)).toBe(expected);
  });
});
