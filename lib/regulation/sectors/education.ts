import type { Sector } from "../types";

export const EDUCATION: Sector = {
  key: "education",
  label: "Education and edtech",
  prefix: "EDU",
  blurb: "Schools, colleges and edtech platforms: most users are children, so parental consent and the ban on tracking children come first.",
  regulators: ["Ministry of Education", "State education departments", "UGC"],
  instruments: [
    { id: "dpdp-children-edu", name: "DPDP Act s.9 and Rules 10 to 12 (children's data), applied to education", regulator: "MeitY", kind: "law", confirmed: true, summary: "Verifiable parental consent before processing a child's data; no tracking, behavioural monitoring or targeted ads aimed at children. Rule 12 and the Fourth Schedule exempt educational institutions only as far as tracking and monitoring are needed for educational activities or the safety of enrolled children." },
    { id: "edu-records", name: "Education records and examination body rules", regulator: "State boards, UGC", kind: "regulation", confirmed: false, summary: "Student and examination records are kept for the periods the board or university requires." },
  ],
  controls: [
    { code: "EDU-01", title: "Verifiable parental consent for student data", type: "preventive", instrument: "dpdp-children-edu", description: "Parental consent is obtained and verified before processing a child's data on enrolment or on a learning platform, and the record can be produced.", related: ["CHI-01", "CON-01"] },
    { code: "EDU-02", title: "No tracking or targeted advertising to students", type: "preventive", instrument: "dpdp-children-edu", description: "Learning apps do not track or profile students for advertising, and any monitoring is limited to what the educational activity or student safety needs.", related: ["CHI-01"] },
    { code: "EDU-03", title: "Student records retention and access", type: "preventive", instrument: "edu-records", description: "Student and examination records are kept for the period the rules require, access is limited to staff who need it, and the retention schedule names the legal basis.", related: ["RET-01", "SEC-02"] },
    { code: "EDU-04", title: "Third-party learning tools and student data", type: "preventive", instrument: "dpdp-children-edu", description: "Learning apps, proctoring and cloud tools that receive student data are chosen after due diligence and bound by agreements that prohibit secondary use.", related: ["PRO-01", "PRO-02"] },
  ],
  dpdpInterplay: [
    "Almost every student is a child under 18, so s.9 applies by default. The fine for failing the children's duties can reach ₹200 crore.",
    "The class-wide Fourth Schedule exemption is narrow. Do not assume it covers marketing or analytics.",
  ],
  typicalEvidence: ["Admission form with parental consent", "Learning app privacy notice", "Vendor agreements for learning tools", "Student records retention schedule"],
};
