import assert from "node:assert/strict";
import test from "node:test";
import { parseProcurementRequest } from "../src/domain.js";

const valid = {
  request_id: "REQ-2026-0001",
  category: "software",
  amount_usd_cents: 125_000,
  currency: "USD",
  vendor_country: "US",
  data_classification: "internal",
  security_reviewed: false,
  business_purpose: "internal_operations",
};

test("accepts the bounded procurement schema", () => {
  assert.deepEqual(parseProcurementRequest(valid), valid);
});

test("rejects PII and other undeclared fields", () => {
  assert.throws(
    () => parseProcurementRequest({ ...valid, requester_email: "person@example.com" }),
    /unsupported fields: requester_email/,
  );
});

test("rejects fractional amounts", () => {
  assert.throws(() => parseProcurementRequest({ ...valid, amount_usd_cents: 10.5 }), /safe integer/);
});

test("rejects lowercase country codes", () => {
  assert.throws(() => parseProcurementRequest({ ...valid, vendor_country: "us" }), /uppercase country code/);
});
