import type { Sector } from "../types";

export const ENERGY: Sector = {
  key: "energy",
  label: "Energy and utilities",
  prefix: "ENE",
  blurb: "Power generation and distribution, oil and gas, city gas and renewables: consumer, meter and field-workforce data, and control systems that increasingly share networks with IT.",
  regulators: ["CEA", "Ministry of Power", "PNGRB", "State electricity regulators", "NCIIPC"],
  instruments: [
    { id: "cea-cyber", name: "CEA Cyber Security (Power Sector) Regulations, 2026", regulator: "CEA", kind: "regulation", confirmed: false, summary: "Reported as published in July 2026 and mandatory from 1 April 2027 for generation and storage of 50 MW or more: a named senior security officer, asset register, IT and operational technology separation, annual audit and incident reporting to CSIRT-Power within six hours. Confirm the final text and who is covered." },
    { id: "electricity-act", name: "Electricity Act, 2003 and the Electricity (Rights of Consumers) Rules, 2020", regulator: "Ministry of Power", kind: "law", confirmed: false, summary: "Consumer service rights, billing and metering. Smart prepaid meters bring detailed usage data that points to household habits." },
    { id: "pngrb", name: "PNGRB Act, 2006 and city gas distribution regulations", regulator: "PNGRB", kind: "law", confirmed: false, summary: "Authorisation and service obligations for city gas distribution, with customer connection and safety records." },
    { id: "nciipc-energy", name: "IT Act s.70A and NCIIPC guidelines: power and energy as critical information infrastructure", regulator: "NCIIPC", kind: "guidelines", confirmed: false, summary: "Protected systems in the power and oil and gas sectors carry stricter security, audit and reporting duties." },
  ],
  controls: [
    { code: "ENE-01", title: "Smart meter and consumption data", type: "preventive", instrument: "electricity-act", description: "Meter reading data is collected at the interval the service needs, tied to a stated purpose, kept for a set period, and not used for marketing or shared with third parties without consent.", related: ["PUR-01", "CON-01", "RET-01"] },
    { code: "ENE-02", title: "Consumer connection, billing and complaint records", type: "preventive", instrument: "electricity-act", description: "Connection forms, KYC and billing records are collected with notice, access is limited to those who need it, and consumers can correct details and raise grievances.", related: ["NOT-01", "SEC-02", "RIG-01"] },
    { code: "ENE-03", title: "Separation of control systems from IT networks", type: "preventive", instrument: "cea-cyber", description: "Operational technology that runs plants, grids and pipelines is kept apart from the internet and corporate IT, with remote access only for emergencies, with strong sign-in, monitoring and logs.", related: ["SEC-01", "SEC-02"] },
    { code: "ENE-04", title: "Incident reporting to the sector team and CERT-In", type: "corrective", instrument: "cea-cyber", description: "A procedure reports cyber incidents to the sector response team and CERT-In within six hours, and to the Data Protection Board where personal data is involved, with a named owner.", related: ["CYB-01", "BRE-01", "BRE-02"] },
    { code: "ENE-05", title: "Field workforce, contractor and site-visit data", type: "preventive", instrument: "nciipc-energy", description: "Records of employees, contract labour and visitors at plants and sites, including biometrics and CCTV, have a stated purpose, limited access and a retention period.", related: ["NOT-01", "RET-01", "SEC-02"] },
    { code: "ENE-06", title: "Critical and protected systems register", type: "detective", instrument: "nciipc-energy", description: "Systems notified as protected or critical are listed with owners, tested for security, and any personal data on them is shown in the data inventory.", related: ["INV-01", "SEC-01"] },
  ],
  dpdpInterplay: [
    "Energy utilities usually hold large consumer databases and may be considered for Significant Data Fiduciary status.",
    "Sector rules on incident reporting run in parallel to the DPDP breach duties. One event can trigger a report to the sector team, CERT-In and the Data Protection Board.",
    "Control systems mostly hold machine data rather than personal data. The privacy exposure sits in meter, billing, CRM, workforce and CCTV data.",
  ],
  typicalEvidence: ["Smart meter data-use and retention policy", "Network diagram showing IT and operational technology separation", "Incident response plan with the sector and CERT-In contacts", "Contract labour and visitor record procedure", "Protected systems register"],
};
