import { expect, it } from "vitest";
import { parseAppOrigin, qrBaseUrl } from "../src/lib/app-origin";

it.each([
  ["https://example.com", "https://example.com"],
  ["https://example.com/", "https://example.com"],
  ["https://example.com:8443", "https://example.com:8443"],
  ["http://localhost:3000", "http://localhost:3000"],
])("QR accepts origin %s", (value, origin) => {
  expect(qrBaseUrl(value, "https://request.example")).toBe(origin);
});
it.each([
  undefined,
  "",
  "not a url",
  "/relative",
  "javascript:alert(1)",
  "http://example.com",
  "http://localhost.example.com",
  "https://user:pass@example.com",
  "https://example.com/path",
  "https://example.com?query=1",
  "https://example.com/#hash",
])("QR falls back safely for %s", (value) => {
  expect(qrBaseUrl(value, "https://request.example")).toBe(
    "https://request.example",
  );
  expect(() => parseAppOrigin(value ?? "")).toThrow();
});
