import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type {
  CreateAutomationRuleInput,
  UpdateAutomationRuleInput,
} from './automation.schema';
import {
  createAutomationRule,
  deleteAutomationRule,
  listAutomationRules,
  updateAutomationRule,
} from './automation.service';

function requireUserId(req: Request): string {
  if (!req.user) {
    throw new AppError('Ban chua dang nhap', 401);
  }
  return req.user.id;
}

export const listAutomationRulesHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const rules = await listAutomationRules(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { rules } });
  }
);

export const createAutomationRuleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const rule = await createAutomationRule(
      requireUserId(req),
      req.params.boardId as string,
      req.body as CreateAutomationRuleInput
    );
    res
      .status(201)
      .json({ success: true, message: 'Da tao luat tu dong hoa', data: { rule } });
  }
);

export const updateAutomationRuleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const rule = await updateAutomationRule(
      requireUserId(req),
      req.params.ruleId as string,
      req.body as UpdateAutomationRuleInput
    );
    res.json({ success: true, message: 'Da cap nhat luat', data: { rule } });
  }
);

export const deleteAutomationRuleHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteAutomationRule(requireUserId(req), req.params.ruleId as string);
    res.json({ success: true, message: 'Da xoa luat' });
  }
);
