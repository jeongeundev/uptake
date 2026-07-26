export type SurveyBudget = { perFileChars: number; totalChars: number };

export type SurveyRule = { id: string; include: string[] };

export type SurveyRuleSet = {
  schemaVersion: 1;
  budget: SurveyBudget;
  exclude: string[];
  rules: SurveyRule[];
};

export type CompiledSurveyRules = {
  budget: SurveyBudget;
  exclude: RegExp[];
  rules: { id: string; include: RegExp[] }[];
};
