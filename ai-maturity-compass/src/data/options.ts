/** Option lists for the organization profile wizard and benchmark filters. */

export const ORG_TYPES = [
  { value: 'private_enterprise', label: 'Private enterprise' },
  { value: 'msme', label: 'MSME' },
  { value: 'gcc', label: 'GCC (Global Capability Centre)' },
  { value: 'psu', label: 'PSU (Public Sector Undertaking)' },
  { value: 'government', label: 'Government institution' },
  { value: 'other', label: 'Other' },
] as const;
export type OrgType = (typeof ORG_TYPES)[number]['value'];

export const SECTORS = [
  'Banking & Financial Services',
  'Insurance',
  'Capital Markets & Asset Management',
  'Manufacturing & Industrial',
  'Automotive & Mobility',
  'Retail & Consumer Goods',
  'Healthcare & Life Sciences',
  'IT Services & GCC',
  'Telecom & Media',
  'Energy, Power & Utilities',
  'Infrastructure & Logistics',
  'Education & Skilling',
  'Central / State Government',
  'Public Sector (Other)',
  'Agriculture & Agri-tech',
  'Professional Services',
  'Other',
] as const;

export const SIZE_CATEGORIES = [
  { value: 'micro_small', label: 'Micro / Small', hint: 'Up to ~250 employees' },
  { value: 'medium', label: 'Medium', hint: '~250–1,000 employees' },
  { value: 'large', label: 'Large', hint: '~1,000–10,000 employees' },
  { value: 'very_large', label: 'Very large', hint: 'Above ~10,000 employees' },
] as const;
export type SizeCategory = (typeof SIZE_CATEGORIES)[number]['value'];

export const WORKFORCE_BANDS = [
  'Fewer than 50',
  '50–249',
  '250–999',
  '1,000–4,999',
  '5,000–19,999',
  '20,000 or more',
] as const;

export const REVENUE_BANDS = [
  'Not applicable',
  'Below ₹5 crore',
  '₹5–50 crore',
  '₹50–250 crore',
  '₹250–1,000 crore',
  '₹1,000–5,000 crore',
  '₹5,000–20,000 crore',
  'Above ₹20,000 crore',
] as const;

export const FOOTPRINTS = [
  { value: 'single_location', label: 'Single location' },
  { value: 'multi_city', label: 'Multiple cities in one or a few states' },
  { value: 'pan_india', label: 'Pan-India' },
  { value: 'india_and_international', label: 'India and international' },
  { value: 'global', label: 'Global with India as one of many geographies' },
] as const;

export const AI_STAGES = [
  { value: 'none', label: 'No AI investment or deployment yet' },
  { value: 'exploring', label: 'Exploring — evaluating use cases, no pilots' },
  { value: 'pilots', label: 'Piloting — proofs of concept / pilots running' },
  { value: 'selective', label: 'Selective production — a few live use cases' },
  { value: 'scaling', label: 'Scaling — multiple functions in production' },
  { value: 'enterprise', label: 'Enterprise-wide — AI embedded across the organization' },
] as const;

export const FUNCTIONS = [
  'CEO / business head',
  'CIO / CTO',
  'CDO (data)',
  'CISO (security)',
  'HR head',
  'Finance head',
  'Legal & compliance',
  'Risk management',
  'Operations',
  'Internal audit',
  'Functional business leaders',
] as const;

export const REGULATORY_CONTEXT = [
  'DPDP Act, 2023 and associated rules',
  'RBI',
  'SEBI',
  'IRDAI',
  'Healthcare / health-data regulation',
  'Telecom (DoT / TRAI)',
  'CERT-In directions',
  'Public procurement / government rules',
  'Cross-border data requirements (e.g. client contracts, GDPR)',
] as const;

export const ASSESSMENT_PERIODS = ['FY2024-25', 'FY2025-26', 'FY2026-27', 'Custom'] as const;
