import { api } from '../axios';
import type {
  CardFieldValue,
  CustomField,
  CustomFieldOption,
  CustomFieldType,
} from '../../types/customField';

export async function fetchBoardCustomFields(
  boardId: string
): Promise<CustomField[]> {
  const res = await api.get<{ data: { fields: CustomField[] } }>(
    `/boards/${boardId}/custom-fields`
  );
  return res.data.data.fields;
}

export async function createCustomField(
  boardId: string,
  input: {
    name: string;
    type: CustomFieldType;
    options?: { value: string; color?: string }[];
  }
): Promise<CustomField> {
  const res = await api.post<{ data: { field: CustomField } }>(
    `/boards/${boardId}/custom-fields`,
    input
  );
  return res.data.data.field;
}

export async function updateCustomField(
  fieldId: string,
  input: { name?: string; position?: number }
): Promise<CustomField> {
  const res = await api.patch<{ data: { field: CustomField } }>(
    `/custom-fields/${fieldId}`,
    input
  );
  return res.data.data.field;
}

export async function deleteCustomField(fieldId: string): Promise<void> {
  await api.delete(`/custom-fields/${fieldId}`);
}

export async function addFieldOption(
  fieldId: string,
  input: { value: string; color?: string }
): Promise<CustomFieldOption> {
  const res = await api.post<{ data: { option: CustomFieldOption } }>(
    `/custom-fields/${fieldId}/options`,
    input
  );
  return res.data.data.option;
}

export async function updateFieldOption(
  optionId: string,
  input: { value?: string; color?: string | null; position?: number }
): Promise<CustomFieldOption> {
  const res = await api.patch<{ data: { option: CustomFieldOption } }>(
    `/custom-field-options/${optionId}`,
    input
  );
  return res.data.data.option;
}

export async function deleteFieldOption(optionId: string): Promise<void> {
  await api.delete(`/custom-field-options/${optionId}`);
}

// value: string (TEXT/DATE/optionId cua DROPDOWN) | number (NUMBER) |
// boolean (CHECKBOX) | null (xoa gia tri)
export async function setCardFieldValue(
  cardId: string,
  fieldId: string,
  value: string | number | boolean | null
): Promise<CardFieldValue | null> {
  const res = await api.put<{ data: { value: CardFieldValue | null } }>(
    `/cards/${cardId}/custom-fields/${fieldId}`,
    { value }
  );
  return res.data.data.value;
}
