/**
 * The default sales pipeline seeded into every new workspace (RFC-002 §2.2, Phase 1). A 6-stage
 * standard B2B funnel; `probability` is the forecast weight and is a string to match the
 * `numeric(3,2)` column. Adjustable per-tenant via the pipeline API in later phases — this is only
 * the initial seed.
 */
export type StageCategory = 'open' | 'won' | 'lost';

export interface DefaultStage {
  name: string;
  position: number;
  probability: string;
  category: StageCategory;
}

export const DEFAULT_PIPELINE_NAME = 'Sales Pipeline';

export const DEFAULT_STAGES: readonly DefaultStage[] = [
  { name: 'Lead In', position: 1, probability: '0.10', category: 'open' },
  { name: 'Qualified', position: 2, probability: '0.25', category: 'open' },
  { name: 'Proposal Sent', position: 3, probability: '0.50', category: 'open' },
  { name: 'Negotiation', position: 4, probability: '0.75', category: 'open' },
  { name: 'Won', position: 5, probability: '1.00', category: 'won' },
  { name: 'Lost', position: 6, probability: '0.00', category: 'lost' },
];
