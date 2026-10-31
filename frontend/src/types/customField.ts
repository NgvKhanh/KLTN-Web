export type CustomFieldType = 'TEXT' | 'NUMBER' | 'DATE' | 'CHECKBOX' | 'DROPDOWN';

export interface CustomFieldOption {
  id: string;
  fieldId: string;
  value: string;
  color: string | null;
  position: number;
}

export interface CustomField {
  id: string;
  boardId: string;
  name: string;
  type: CustomFieldType;
  position: number;
  options: CustomFieldOption[];
}

export interface CardFieldValue {
  id: string;
  cardId: string;
  fieldId: string;
  textValue: string | null;
  numberValue: number | null;
  dateValue: string | null;
  boolValue: boolean | null;
  optionId: string | null;
}
