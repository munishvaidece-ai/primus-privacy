import type { Sector } from "../types";

export const LOGISTICS: Sector = {
  key: "logistics",
  label: "Logistics, transport and mobility",
  prefix: "LOG",
  blurb: "Couriers, freight, warehousing, fleet and ride or delivery platforms: location and trip data, driver and delivery-partner records and recipient details. Airlines and airports are under Aviation.",
  regulators: ["Ministry of Road Transport and Highways", "State transport departments", "GST authorities"],
  instruments: [
    { id: "mv-aggregator", name: "Motor Vehicles Act, 1988 and the Motor Vehicle Aggregator Guidelines", regulator: "Ministry of Road Transport and Highways", kind: "guidelines", confirmed: false, summary: "Aggregators and fleet operators keep driver and vehicle records and trip data, with safety features such as location tracking and an emergency button." },
    { id: "vltd", name: "Vehicle location tracking device and emergency button requirements (Central Motor Vehicles Rules)", regulator: "Ministry of Road Transport and Highways", kind: "rules", confirmed: false, summary: "Public service vehicles carry location tracking devices and emergency buttons, with data sent to a monitoring centre." },
    { id: "eway", name: "GST e-way bill and transport documentation rules", regulator: "GST authorities", kind: "rules", confirmed: false, summary: "Consignment documents carry consignor, consignee and vehicle details, which are shared with authorities." },
  ],
  controls: [
    { code: "LOG-01", title: "Location and trip data: purpose and retention", type: "preventive", instrument: "mv-aggregator", description: "Live location and trip history are collected only for dispatch, safety and billing, shown to staff on need, and deleted or anonymised after a set period.", related: ["PUR-01", "RET-01", "SEC-02"] },
    { code: "LOG-02", title: "Driver and delivery-partner records", type: "preventive", instrument: "mv-aggregator", description: "Licences, KYC, background checks, ratings and earnings are collected with notice, kept safe, shared with customers only as needed, and the person can see and correct them.", related: ["NOT-01", "RIG-01", "SEC-02"] },
    { code: "LOG-03", title: "Recipient and consignee details", type: "preventive", instrument: "eway", description: "Names, phone numbers and addresses on labels, proof-of-delivery apps and tracking pages are limited to what the delivery needs, and masked wherever possible.", related: ["SEC-01", "PUR-01"] },
    { code: "LOG-04", title: "Tracking devices, in-vehicle cameras and monitoring centre", type: "preventive", instrument: "vltd", description: "Vehicle trackers, dashcams and the monitoring centre have a notice, restricted viewing, and defined retention, and footage is released only through a logged request.", related: ["NOT-01", "SEC-02", "RET-01"] },
    { code: "LOG-05", title: "Customs, carrier and warehouse partners", type: "preventive", instrument: "eway", description: "Carriers, 3PL warehouses and customs agents who see recipient data are listed and bound by written terms, with sharing across borders reviewed.", related: ["PRO-01", "XBR-01"] },
  ],
  dpdpInterplay: [
    "Location data can show where a person lives and works. Treat it as sensitive in practice even though DPDP has no separate category.",
    "Gig and delivery partners are individuals whose data you hold, so the same notice, access and correction rules apply to them as to customers.",
  ],
  typicalEvidence: ["Location data retention setting", "Driver onboarding KYC checklist", "Delivery app screen showing masked recipient details", "Dashcam and tracker policy", "3PL and carrier agreement"],
};
