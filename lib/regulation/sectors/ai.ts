import type { Sector } from "../types";

export const AI: Sector = {
  key: "ai",
  label: "AI and data analytics",
  prefix: "AIA",
  blurb: "Organisations that build or use AI, profiling and analytics: lawful training data, algorithmic due diligence and responsible AI guidance on top of DPDP.",
  regulators: ["MeitY"],
  instruments: [
    { id: "ai-governance", name: "India AI Governance Guidelines (MeitY, November 2025)", regulator: "MeitY", kind: "guidelines", confirmed: false, summary: "Principle-based guidance for responsible AI: accountability, transparency, safety and fairness. Voluntary guidance, not a binding law, so describe it that way." },
    { id: "deepfake-advisories", name: "MeitY advisories on deepfakes and AI-generated content", regulator: "MeitY", kind: "guidelines", confirmed: false, summary: "Intermediaries are asked to detect and act on synthetic content and to label AI-generated material." },
    { id: "dpdp-rule-13", name: "DPDP Rule 13 (Significant Data Fiduciary due diligence on algorithmic software)", regulator: "MeitY", kind: "rules", confirmed: true, summary: "A Significant Data Fiduciary verifies that algorithmic software it uses for personal data does not risk the rights of Data Principals." },
  ],
  controls: [
    { code: "AIA-01", title: "Lawful basis for training and analytics data", type: "preventive", instrument: "ai-governance", description: "Personal data used to train or tune models is covered by consent or another lawful ground, and the purpose is stated and not exceeded.", related: ["LEG-01", "PUR-01", "CON-01"] },
    { code: "AIA-02", title: "Algorithmic due diligence and bias checks", type: "preventive", instrument: "dpdp-rule-13", description: "Models and algorithms that make or influence decisions about people are assessed for risk to individuals' rights, with a record of the assessment and its outcome.", related: ["SDF-01", "SDF-02"] },
    { code: "AIA-03", title: "Human oversight and explanation for automated decisions", type: "preventive", instrument: "ai-governance", description: "Significant decisions about people have a human review route, and people can ask how a decision was reached.", related: ["RIG-01", "RIG-02"] },
    { code: "AIA-04", title: "AI inventory and responsible AI governance", type: "preventive", instrument: "ai-governance", description: "A register lists each AI system, its owner, its data, and its intended use, with a named accountable person and a review cycle.", related: ["GOV-01", "GOV-02"] },
    { code: "AIA-05", title: "Synthetic content labelling and misuse controls", type: "preventive", instrument: "deepfake-advisories", description: "Synthetic or AI-generated content is labelled, and a process exists to detect and act on misuse involving real people.", related: [] },
  ],
  dpdpInterplay: [
    "DPDP s.3(c)(ii) excludes personal data that is made publicly available by the Data Principal or under a legal duty to publish. It does not cover everything on the internet, so scraped training data needs a careful lawful-ground review.",
    "Automated profiling of individuals strengthens the case for Significant Data Fiduciary treatment.",
  ],
  typicalEvidence: ["AI system register", "Training data source and consent record", "Model risk or bias assessment", "Human review procedure", "AI governance policy"],
};
