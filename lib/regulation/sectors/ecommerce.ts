import type { Sector } from "../types";

export const ECOMMERCE: Sector = {
  key: "ecommerce",
  label: "E-commerce and retail",
  prefix: "ECM",
  blurb: "Online marketplaces, retailers and consumer apps: consumer protection rules, dark patterns, payment data and the DPDP erasure schedule for e-commerce.",
  regulators: ["Department of Consumer Affairs", "CCPA", "RBI"],
  instruments: [
    { id: "ecom-rules", name: "Consumer Protection (E-Commerce) Rules, 2020", regulator: "Department of Consumer Affairs", kind: "rules", confirmed: false, summary: "E-commerce entities disclose seller and product information, set up grievance redressal with a named officer, and protect consumer data." },
    { id: "dark-patterns", name: "Guidelines for Prevention and Regulation of Dark Patterns, 2023", regulator: "CCPA", kind: "guidelines", confirmed: false, summary: "Interfaces must not trick users, for example through false urgency, forced actions, hidden costs or drip pricing. Consent flows need a check against the listed patterns." },
    { id: "card-token", name: "RBI card-on-file tokenisation rules", regulator: "RBI", kind: "directions", confirmed: false, summary: "Merchants do not store actual card numbers. Tokens are used instead." },
    { id: "dpdp-third-schedule", name: "DPDP Rules, Third Schedule: retention for e-commerce, gaming and social media (Rule 8(3))", regulator: "MeitY", kind: "rules", confirmed: true, summary: "Large e-commerce entities, online gaming intermediaries and social media intermediaries above stated user thresholds erase personal data after three years of the user's last interaction, after giving at least 48 hours' notice. Check the Schedule for the thresholds." },
  ],
  controls: [
    { code: "ECM-01", title: "Consumer grievance officer and redressal", type: "corrective", instrument: "ecom-rules", description: "A grievance officer is named on the platform, consumer complaints are acknowledged and resolved in the prescribed time, and records are kept.", related: ["RIG-02"] },
    { code: "ECM-02", title: "Dark patterns check on consent and sign-up flows", type: "preventive", instrument: "dark-patterns", description: "Consent, sign-up, cancellation and checkout flows are reviewed against the dark pattern guidelines, so consent is free, specific and as easy to withdraw as to give.", related: ["CON-01", "CON-02"] },
    { code: "ECM-03", title: "Payment card data: tokenisation and no raw storage", type: "preventive", instrument: "card-token", description: "Card details are tokenised, raw card numbers are not stored by the merchant, and payment data access is restricted.", related: ["SEC-01"] },
    { code: "ECM-04", title: "Three-year inactivity erasure with advance notice", type: "preventive", instrument: "dpdp-third-schedule", description: "Where the Third Schedule applies, user data is erased three years after last interaction, with notice at least 48 hours beforehand, subject to legal retention.", related: ["RET-01", "ACC-01"] },
    { code: "ECM-05", title: "Marketing, profiling and recommendation consent", type: "preventive", instrument: "ecom-rules", description: "Marketing, personalised ads and profiling rest on separate, withdrawable consent, and the consent record can be produced per user.", related: ["CON-01", "CON-03", "PUR-01"] },
  ],
  dpdpInterplay: [
    "Consumer-facing platforms depend heavily on consent. A consent flow that fails the dark patterns guidelines may also fail the DPDP test of free, specific and unambiguous consent.",
    "Large platforms may also be notified as Significant Data Fiduciaries.",
  ],
  typicalEvidence: ["Sign-up and checkout consent screenshots", "Grievance officer page", "Payment gateway tokenisation attestation", "Inactivity erasure job configuration", "Marketing consent register"],
};
