import type { Sector } from "../types";

export const REALESTATE: Sector = {
  key: "realestate",
  label: "Real estate and construction",
  prefix: "REA",
  blurb: "Developers, brokers, property managers and co-living or facility firms: buyer and lead data, KYC, home-loan sharing and resident and visitor records.",
  regulators: ["State RERA authorities", "Ministry of Housing and Urban Affairs"],
  instruments: [
    { id: "rera", name: "Real Estate (Regulation and Development) Act, 2016 and state RERA rules", regulator: "State RERA authorities", kind: "law", confirmed: false, summary: "Project and promoter disclosures, allottee records and agreements, and complaint handling. Allottee details are shared with authorities and banks in set ways." },
    { id: "trai-leads", name: "TRAI commercial communications rules for lead follow-up", regulator: "TRAI", kind: "regulation", confirmed: false, summary: "Promotional calls and messages to buyers and leads must use registered headers and honour preferences. See the cross-sector set." },
  ],
  controls: [
    { code: "REA-01", title: "Buyer and lead data: notice, consent and purpose", type: "preventive", instrument: "trai-leads", description: "Enquiry forms, site-visit registers, portal leads and walk-ins have a notice, consent for follow-up marketing, and a rule against reselling or sharing leads without consent.", related: ["NOT-01", "CON-01", "PUR-01"] },
    { code: "REA-02", title: "KYC and allottee records", type: "preventive", instrument: "rera", description: "Identity, PAN and payment documents of buyers are collected only as needed, stored securely, and shared with banks, authorities and agents only for a stated reason.", related: ["SEC-01", "SEC-02", "PRO-01"] },
    { code: "REA-03", title: "Brokers, channel partners and agents", type: "preventive", instrument: "rera", description: "Brokers and channel partners who collect or see buyer data are listed and bound by agreements, and lead sources are traceable.", related: ["PRO-01", "PRO-02"] },
    { code: "REA-04", title: "Resident, visitor and facility data", type: "preventive", instrument: "rera", description: "Resident apps, visitor logs, CCTV and access cards in managed properties have a notice, restricted access, and retention periods.", related: ["NOT-01", "SEC-02", "RET-01"] },
    { code: "REA-05", title: "Home-loan and partner sharing", type: "preventive", instrument: "rera", description: "Buyer details shared with lenders, insurers and furnishing partners go under agreements, only after the buyer has agreed.", related: ["CON-01", "PRO-01"] },
  ],
  dpdpInterplay: [
    "Real estate runs on leads, so most exposure is marketing and sharing. Consent records are the first thing to check.",
    "Co-living, student housing and managed properties hold resident and visitor data that can reveal daily routine.",
  ],
  typicalEvidence: ["Enquiry form with notice and consent", "Channel partner agreement", "KYC document storage access list", "Visitor management app privacy notice", "CCTV retention policy"],
};
