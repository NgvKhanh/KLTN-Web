import { api } from '../axios';

export type RecurrenceFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export interface RecurringSchedule {
  id: string;
  listId: string;
  createdById: string;
  title: string;
  description: string | null;
  cardTemplateId: string | null;
  frequency: RecurrenceFrequency;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  timeOfDay: string;
  startDate: string;
  endDate: string | null;
  isPaused: boolean;
  lastRunAt: string | null;
  nextRunAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecurringScheduleInput {
  title: string;
  description?: string;
  cardTemplateId?: string;
  frequency: RecurrenceFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  timeOfDay: string;
  startDate?: string;
  endDate?: string | null;
}

export type UpdateRecurringScheduleInput = Partial<CreateRecurringScheduleInput> & {
  isPaused?: boolean;
};

export async function fetchRecurringSchedules(
  listId: string
): Promise<RecurringSchedule[]> {
  const res = await api.get<{ data: { schedules: RecurringSchedule[] } }>(
    `/lists/${listId}/recurring-schedules`
  );
  return res.data.data.schedules;
}

export async function createRecurringSchedule(
  listId: string,
  input: CreateRecurringScheduleInput
): Promise<RecurringSchedule> {
  const res = await api.post<{ data: { schedule: RecurringSchedule } }>(
    `/lists/${listId}/recurring-schedules`,
    input
  );
  return res.data.data.schedule;
}

export async function updateRecurringSchedule(
  scheduleId: string,
  input: UpdateRecurringScheduleInput
): Promise<RecurringSchedule> {
  const res = await api.patch<{ data: { schedule: RecurringSchedule } }>(
    `/recurring-schedules/${scheduleId}`,
    input
  );
  return res.data.data.schedule;
}

export async function deleteRecurringSchedule(scheduleId: string): Promise<void> {
  await api.delete(`/recurring-schedules/${scheduleId}`);
}
