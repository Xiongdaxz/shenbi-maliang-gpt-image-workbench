import { afterEach, describe, expect, test } from "bun:test";
import { useImageCompare } from "./imageCompare";

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
const entries = new Map<string, string>();
function storage(throwOnWrite = false) {
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { if (throwOnWrite) throw new Error("unavailable"); entries.set(key, value); },
    removeItem: (key: string) => entries.delete(key)
  } });
}
afterEach(() => {
  useImageCompare.getState().bindOwner(null);
  entries.clear();
  if (originalDescriptor) Object.defineProperty(globalThis, "sessionStorage", originalDescriptor);
  else Reflect.deleteProperty(globalThis, "sessionStorage");
});

describe("account-scoped comparison lifecycle", () => {
  test("navigation closes the view without discarding the resumable draft", () => {
    storage();
    useImageCompare.getState().bindOwner("alice");
    useImageCompare.getState().start(["b", "a"]);
    useImageCompare.getState().close();
    expect(useImageCompare.getState().open).toBe(false);
    expect(useImageCompare.getState().draft?.imageIds).toEqual(["b", "a"]);
    useImageCompare.getState().resume();
    expect(useImageCompare.getState().open).toBe(true);
  });
  test("reload restores IDs and view state for the same account", () => {
    storage();
    useImageCompare.getState().bindOwner("alice");
    useImageCompare.getState().start(["b", "a"]);
    useImageCompare.setState({ ownerId: null, draft: null, open: false }); // New page instance.
    useImageCompare.getState().bindOwner("alice");
    expect(useImageCompare.getState().draft?.imageIds).toEqual(["b", "a"]);
    expect(useImageCompare.getState().open).toBe(false);
    useImageCompare.getState().bindOwner("alice"); // StrictMode / authentication refresh.
    expect(useImageCompare.getState().draft?.imageIds).toEqual(["b", "a"]);
  });
  test("a new message comparison replaces the previous selection and activates A", () => {
    storage();
    const comparison = useImageCompare.getState();
    comparison.bindOwner("alice");
    comparison.start(["previous-a", "previous-b"]);
    comparison.save({ ...useImageCompare.getState().draft!, activeId: "previous-b" });
    comparison.start(["clicked", "other-result"]);
    expect(useImageCompare.getState().draft?.imageIds).toEqual(["clicked", "other-result"]);
    expect(useImageCompare.getState().draft?.activeId).toBe("clicked");
  });
  test("account switch and logout remove the previous account's draft", () => {
    storage();
    useImageCompare.getState().bindOwner("alice");
    useImageCompare.getState().start(["b", "a"]);
    useImageCompare.getState().bindOwner("bob");
    expect(useImageCompare.getState().draft).toBeNull();
    expect(entries.size).toBe(0);
    useImageCompare.getState().start(["c", "d"]);
    useImageCompare.getState().bindOwner(null);
    expect(useImageCompare.getState().open).toBe(false);
    expect(entries.size).toBe(0);
  });
  test("unavailable browser storage does not prevent an in-memory comparison", () => {
    storage(true);
    useImageCompare.getState().bindOwner("alice");
    useImageCompare.getState().start(["a", "b"]);
    expect(useImageCompare.getState().open).toBe(true);
    expect(useImageCompare.getState().draft?.imageIds).toEqual(["a", "b"]);
  });
});
