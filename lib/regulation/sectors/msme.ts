import type { Sector } from "../types";

export const MSME: Sector = {
  key: "msme",
  label: "MSMEs and small businesses",
  prefix: "MSM",
  blurb: "Small and micro businesses. If you are a small business, also choose your industry sector, because sector rules still apply to you. The Act has no size exemption, so the aim is a proportionate set of essentials a small firm can actually do.",
  regulators: ["Data Protection Board of India", "MSME Ministry (support schemes)"],
  instruments: [
    { id: "dpdp-msme", name: "DPDP Act, 2023: application to small businesses", regulator: "MeitY", kind: "law", confirmed: true, summary: "The Act applies by what an organisation does with personal data, not by its size. The Government can exempt classes of Data Fiduciaries, including startups, from some duties (s.17(3)). Check the latest notification before telling a client they are exempt." },
  ],
  controls: [
    { code: "MSM-01", title: "Personal data list and a simple notice", type: "preventive", instrument: "dpdp-msme", description: "The business keeps a short list of what personal data it holds and why, and gives customers a plain notice when collecting it.", related: ["INV-01", "NOT-01"] },
    { code: "MSM-02", title: "Basic security essentials", type: "preventive", instrument: "dpdp-msme", description: "Devices and accounts have strong passwords and multi-factor sign-in, software is updated, data is backed up, and only people who need customer data can reach it.", related: ["SEC-01", "SEC-02"] },
    { code: "MSM-03", title: "A named person for privacy questions and breaches", type: "corrective", instrument: "dpdp-msme", description: "One person is named to answer privacy requests and to act if data is lost, with a short written step list to tell the Board and affected customers.", related: ["GOV-01", "BRE-01", "RIG-02"] },
    { code: "MSM-04", title: "Small suppliers handling customer data", type: "preventive", instrument: "dpdp-msme", description: "Accountants, payroll, software and marketing suppliers that see customer data are listed, and each has a written promise to protect it.", related: ["PRO-01"] },
    { code: "MSM-05", title: "Marketing messages: ask first, stop when asked", type: "preventive", instrument: "dpdp-msme", description: "Customers are asked before they get marketing calls, messages or emails, each message says how to stop, and a request to stop is acted on and recorded.", related: ["CON-01", "CON-02"] },
    { code: "MSM-06", title: "Check and record whether an exemption applies", type: "detective", instrument: "dpdp-msme", description: "The business writes down whether any Government notification exempts it, for example as a startup, and reviews that note every quarter. Until one clearly applies, it treats the Act as applying in full.", related: ["GOV-01"] },
  ],
  dpdpInterplay: [
    "The penalty ceilings in the Schedule are maximums, and the Board looks at how serious and repeated a failure is and whether it was put right. A small firm that acts in good faith is in a different position from one that ignores the rules.",
    "A startup exemption under s.17(3) needs a Government notification. Until you have confirmed one covers the client, assume the Act applies in full.",
  ],
  typicalEvidence: ["Customer data list", "Simple privacy notice", "Backup and sign-in settings screenshot", "Named privacy contact", "Supplier list with agreements"],
};
