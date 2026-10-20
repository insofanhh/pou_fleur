// Product identities stay stable when platform edits names, prices or quotas.
export const EXPERIENCE_PLAN_ID = 4;
export const isExperiencePlan = (id: number) => Number(id) === EXPERIENCE_PLAN_ID;
export const planRank = (id: number) => isExperiencePlan(id) ? 0 : Number(id);
export const paidTrialUsed = (claims: unknown[]) => claims.length > 0;
