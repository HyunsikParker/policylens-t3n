const policy = {
  version: "2026-09-01",
  max_auto_approve_usd_cents: 250000,
  allowed_categories: ["cloud_services", "office_supplies", "professional_services", "software"],
  blocked_countries: ["KP"],
  classifications_requiring_security_review: ["confidential", "restricted"],
};

const fixtures = {
  approve: {
    request_id: "REQ-2026-0001", category: "software", amount_usd_cents: 125000,
    currency: "USD", vendor_country: "US", data_classification: "internal",
    security_reviewed: false, business_purpose: "internal_operations",
  },
  review: {
    request_id: "REQ-2026-0002", category: "cloud_services", amount_usd_cents: 480000,
    currency: "USD", vendor_country: "DE", data_classification: "confidential",
    security_reviewed: false, business_purpose: "customer_delivery",
  },
  deny: {
    request_id: "REQ-2026-0003", category: "gift_cards", amount_usd_cents: 50000,
    currency: "USD", vendor_country: "US", data_classification: "public",
    security_reviewed: true, business_purpose: "internal_operations",
  },
};

const labels = {
  request_id: "Request ID", category: "Category", amount_usd_cents: "Amount",
  currency: "Currency", vendor_country: "Vendor country", data_classification: "Data class",
  security_reviewed: "Security reviewed", business_purpose: "Business purpose",
};

function evaluate(request) {
  const deny = [];
  const review = [];
  if (policy.blocked_countries.includes(request.vendor_country)) deny.push("vendor_country_blocked");
  if (!policy.allowed_categories.includes(request.category)) deny.push("category_not_allowed");
  if (request.amount_usd_cents > policy.max_auto_approve_usd_cents) review.push("amount_above_auto_approve_limit");
  if (request.data_classification === "restricted") review.push("restricted_data");
  if (policy.classifications_requiring_security_review.includes(request.data_classification) && !request.security_reviewed) {
    review.push("security_review_required");
  }
  if (deny.length) return { decision: "deny", reasons: [...new Set(deny)].sort() };
  if (review.length) return { decision: "human_review", reasons: [...new Set(review)].sort() };
  return { decision: "approve", reasons: ["policy_checks_passed"] };
}

function formatValue(key, value) {
  if (key === "amount_usd_cents") return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value / 100);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value).replaceAll("_", " ");
}

async function fingerprint(request) {
  const bytes = new TextEncoder().encode(JSON.stringify(request));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function render(name) {
  const request = fixtures[name];
  const result = evaluate(request);
  const fields = document.querySelector("#request-fields");
  fields.replaceChildren(...Object.entries(request).map(([key, value]) => {
    const row = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    term.textContent = labels[key];
    detail.textContent = formatValue(key, value);
    row.append(term, detail);
    return row;
  }));

  const state = document.querySelector("#decision-state");
  state.className = `decision-state ${result.decision === "human_review" ? "review" : result.decision}`;
  document.querySelector("#decision-label").textContent = result.decision.replace("_", " ");
  document.querySelector("#policy-version").textContent = policy.version;
  document.querySelector("#reason-code").textContent = result.reasons.join(" · ");
  const digest = await fingerprint(request);
  document.querySelector("#fingerprint").textContent = `${digest.slice(0, 18)}…${digest.slice(-8)}`;
}

document.querySelectorAll("[data-fixture]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll("[data-fixture]").forEach((candidate) => candidate.setAttribute("aria-selected", "false"));
    button.setAttribute("aria-selected", "true");
    void render(button.dataset.fixture);
  });
});

void render("approve");
