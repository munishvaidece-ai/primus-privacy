import type { Sector } from "../types";

export const MANUFACTURING: Sector = {
  key: "manufacturing",
  label: "Manufacturing and industrials",
  prefix: "MFG",
  blurb: "Factories and industrial groups, including automotive: worker and contractor records, biometric attendance, dealer and customer data, and connected products.",
  regulators: ["Ministry of Labour and Employment", "State labour departments", "UIDAI", "BIS"],
  instruments: [
    { id: "labour-codes", name: "The four Labour Codes (Wages, Industrial Relations, Social Security, Occupational Safety), 2019 and 2020", regulator: "Ministry of Labour and Employment", kind: "law", confirmed: false, summary: "Registers and records of workers, wages, attendance and safety, including contract labour. Check the commencement status and the rules of the state of operation." },
    { id: "factories", name: "Factories Act, 1948 (where still applicable) and state factory rules", regulator: "State labour departments", kind: "law", confirmed: false, summary: "Registers of workers, health surveillance and accident records kept at each factory." },
    { id: "dpdp-general-mfg", name: "DPDP Act s.5, s.6, s.8(2) and s.8(5) applied to dealer, customer and connected-product data", regulator: "MeitY", kind: "law", confirmed: true, summary: "Notice, consent or another valid ground, written terms with processors and reasonable security safeguards apply to dealer, warranty and connected-product data just as they do elsewhere." },
    { id: "aadhaar-mfg", name: "Aadhaar Act, 2016 and Aadhaar (Authentication) regulations, as they apply to private entities", regulator: "UIDAI", kind: "law", confirmed: false, summary: "Private entities may use Aadhaar authentication only under an approved purpose and arrangement, so many employers use other biometric or card systems instead." },
  ],
  controls: [
    { code: "MFG-01", title: "Worker, contract labour and payroll records", type: "preventive", instrument: "labour-codes", description: "Records of employees and contractors' workers are kept on a stated basis, with access limited to HR, payroll and compliance, and shared with contractors only as needed.", related: ["LEG-01", "SEC-02", "PRO-01"] },
    { code: "MFG-02", title: "Biometric attendance and access control", type: "preventive", instrument: "aadhaar-mfg", description: "Biometric and card attendance systems have a lawful basis, a notice, an alternative for those who object, secure storage of templates, and a retention period.", related: ["NOT-01", "SEC-01", "RET-01"] },
    { code: "MFG-03", title: "Health and safety records", type: "preventive", instrument: "factories", description: "Medical examination, accident and exposure records are kept apart from general HR files, with tight access and retention as the rules require.", related: ["SEC-02", "RET-01"] },
    { code: "MFG-04", title: "Dealer, distributor and customer data", type: "preventive", instrument: "dpdp-general-mfg", description: "Dealer, warranty and customer data collected through dealers and service centres is listed, covered by agreements, and shared on a need basis.", related: ["INV-01", "PRO-01"] },
    { code: "MFG-05", title: "Connected products and telematics", type: "preventive", instrument: "dpdp-general-mfg", description: "Data from connected machines, vehicles and devices that can be linked to a person has a notice, a purpose limit and a retention period, and its sharing with partners is controlled.", related: ["NOT-01", "PUR-01", "RET-01"] },
    { code: "MFG-06", title: "CCTV and site security", type: "preventive", instrument: "factories", description: "CCTV and gate records have signs, restricted viewing, and a retention period, and are produced only through a logged request.", related: ["NOT-01", "SEC-02", "RET-01"] },
  ],
  dpdpInterplay: [
    "For manufacturers, employee and contract-worker data is often the largest volume of personal data. Employment is a legitimate use under s.7(i) for what the employer needs, but notice, security and breach duties remain.",
    "Contractors who process worker data for you are Data Processors. The contract should say so.",
  ],
  typicalEvidence: ["Contract labour register and contractor agreement", "Biometric attendance notice and alternative procedure", "Medical examination records access list", "Dealer data-sharing agreement", "CCTV retention and access policy"],
};
