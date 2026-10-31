import { api } from '../axios';

export type AutomationTriggerType = 'CARD_CREATED' | 'CARD_MOVED_TO_LIST';
export type AutomationActionType = 'SET_DONE' | 'ADD_LABEL' | 'ASSIGN_MEMBER';

export interface AutomationAction {
  id: string;
  position: number;
  type: AutomationActionType;
  boolValue: boolean | null;
  labelId: string | null;
  userId: string | null;
}

export interface AutomationRule {
  id: string;
  boardId: string;
  createdById: string;
  name: string;
  isEnabled: boolean;
  triggerType: AutomationTriggerType;
  triggerListId: string | null;
  actions: AutomationAction[];
  createdAt: string;
  updatedAt: string;
}

export interface AutomationActionInput {
  type: AutomationActionType;
  boolValue?: boolean;
  labelId?: string;
  userId?: string;
}

export interface CreateAutomationRuleInput {
  name: string;
  isEnabled?: boolean;
  triggerType: AutomationTriggerType;
  triggerListId?: string;
  actions: AutomationActionInput[];
}

export type UpdateAutomationRuleInput = Partial<CreateAutomationRuleInput> & {
  triggerListId?: string | null;
};

export async function fetchAutomationRules(boardId: string): Promise<AutomationRule[]> {
  const res = await api.get<{ data: { rules: AutomationRule[] } }>(
    `/boards/${boardId}/automation-rules`
  );
  return res.data.data.rules;
}

export async function createAutomationRule(
  boardId: string,
  input: CreateAutomationRuleInput
): Promise<AutomationRule> {
  const res = await api.post<{ data: { rule: AutomationRule } }>(
    `/boards/${boardId}/automation-rules`,
    input
  );
  return res.data.data.rule;
}

export async function updateAutomationRule(
  ruleId: string,
  input: UpdateAutomationRuleInput
): Promise<AutomationRule> {
  const res = await api.patch<{ data: { rule: AutomationRule } }>(
    `/automation-rules/${ruleId}`,
    input
  );
  return res.data.data.rule;
}

export async function deleteAutomationRule(ruleId: string): Promise<void> {
  await api.delete(`/automation-rules/${ruleId}`);
}
