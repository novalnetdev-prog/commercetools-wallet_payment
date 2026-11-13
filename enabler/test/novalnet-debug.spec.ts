import { novalnetDebug, novalnetDebugError, novalnetDebugRequestId } from "../src/utils/novalnet-debug";

test("safe debug logs include stage and occurrence count", () => {
  const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    novalnetDebug("debug-test.single", { method: "googlepay" });
    expect(spy).toHaveBeenCalledWith("[Novalnet][DEBUG]", {
      stage: "debug-test.single", count: 1, method: "googlepay",
    });
  } finally {
    spy.mockRestore();
  }
});

test("debug diagnostics sample repeated lifecycle events to avoid flooding", () => {
  const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);
  try {
    for (let i = 0; i < 26; i++) novalnetDebug("debug-test.repeated");
    expect(spy).toHaveBeenCalledTimes(10); // 1..8, 10, 25
    expect(spy.mock.calls.at(-1)?.[1]).toEqual({ stage: "debug-test.repeated", count: 25 });
  } finally {
    spy.mockRestore();
  }
});

test("debug errors preserve exception name/message/stack", () => {
  const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    novalnetDebugError("debug-test.error", new Error("SDK failed"), { method: "applepay" });
    expect(spy.mock.calls[0][0]).toBe("[Novalnet][DEBUG][ERROR]");
    expect(spy.mock.calls[0][1]).toMatchObject({
      stage: "debug-test.error", method: "applepay", name: "Error", message: "SDK failed",
    });
  } finally {
    spy.mockRestore();
  }
});

test("browser and processor request IDs have a safe shared prefix", () => {
  const a = novalnetDebugRequestId();
  const b = novalnetDebugRequestId();
  expect(a).toMatch(/^nn-[a-zA-Z0-9-]+$/);
  expect(a).not.toEqual(b);
});
