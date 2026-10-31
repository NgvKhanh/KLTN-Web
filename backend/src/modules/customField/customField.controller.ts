import type { Request, Response } from 'express';
import { AppError } from '../../utils/AppError';
import { asyncHandler } from '../../utils/asyncHandler';
import type {
  AddFieldOptionInput,
  CreateCustomFieldInput,
  SetCardFieldValueInput,
  UpdateCustomFieldInput,
  UpdateFieldOptionInput,
} from './customField.schema';
import {
  addFieldOption,
  createCustomField,
  deleteCustomField,
  deleteFieldOption,
  listCustomFields,
  setCardFieldValue,
  updateCustomField,
  updateFieldOption,
} from './customField.service';

function requireUserId(req: Request): string {
  if (!req.user) throw new AppError('Ban chua dang nhap', 401);
  return req.user.id;
}

export const listCustomFieldsHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const fields = await listCustomFields(
      requireUserId(req),
      req.params.boardId as string
    );
    res.json({ success: true, data: { fields } });
  }
);

export const createCustomFieldHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const field = await createCustomField(
      requireUserId(req),
      req.params.boardId as string,
      req.body as CreateCustomFieldInput
    );
    res.status(201).json({ success: true, data: { field } });
  }
);

export const updateCustomFieldHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const field = await updateCustomField(
      requireUserId(req),
      req.params.fieldId as string,
      req.body as UpdateCustomFieldInput
    );
    res.json({ success: true, data: { field } });
  }
);

export const deleteCustomFieldHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteCustomField(requireUserId(req), req.params.fieldId as string);
    res.json({ success: true, message: 'Da xoa truong tuy chinh' });
  }
);

export const addFieldOptionHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const option = await addFieldOption(
      requireUserId(req),
      req.params.fieldId as string,
      req.body as AddFieldOptionInput
    );
    res.status(201).json({ success: true, data: { option } });
  }
);

export const updateFieldOptionHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const option = await updateFieldOption(
      requireUserId(req),
      req.params.optionId as string,
      req.body as UpdateFieldOptionInput
    );
    res.json({ success: true, data: { option } });
  }
);

export const deleteFieldOptionHandler = asyncHandler(
  async (req: Request, res: Response) => {
    await deleteFieldOption(requireUserId(req), req.params.optionId as string);
    res.json({ success: true, message: 'Da xoa lua chon' });
  }
);

export const setCardFieldValueHandler = asyncHandler(
  async (req: Request, res: Response) => {
    const value = await setCardFieldValue(
      requireUserId(req),
      req.params.cardId as string,
      req.params.fieldId as string,
      req.body as SetCardFieldValueInput
    );
    res.json({ success: true, data: { value } });
  }
);
