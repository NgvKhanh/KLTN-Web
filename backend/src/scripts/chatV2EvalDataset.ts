/** Frozen before adding the v2 AI prompt. Symbolic IDs bind to test fixtures, not production data. */
export interface ChatV2EvalCase {
  id: string;
  split: 'dev' | 'test';
  question: string;
  requirements: string[];
  clarification?: 'TIME' | 'ENTITY';
  plans: { tool: 'query_tasks' | 'aggregate_tasks' | 'query_activities'; input: Record<string, unknown> }[];
  expected: Record<string, unknown>[];
}
const range = { from: '2026-10-01', to: '2026-10-04' };
export const CHAT_V2_DATASET_VERSION = 'v2-tools-fixture-1';
export const CHAT_V2_EVAL_CASES: readonly ChatV2EvalCase[] = [
  { id: 'D01', split: 'dev', question: 'Trong bảng 1234 ai có nhiều việc nhất và những việc nào chưa giao?', requirements: ['resolve BOARD_1234', 'both requests', 'all ties'], plans: [
    { tool: 'aggregate_tasks', input: { groupBy: 'ASSIGNEE' } }, { tool: 'query_tasks', input: { filters: { assignment: 'UNASSIGNED' } } },
  ], expected: [{ totalCards: 30, highestCount: 2, unassignedCards: 25 }, { total: 25, hasMore: true }] },
  { id: 'D02', split: 'dev', question: 'Công việc nào đã được thay đổi?', requirements: ['ask for time', 'changes exclude create/comment'], clarification: 'TIME', plans: [], expected: [] },
  { id: 'D03', split: 'dev', question: 'Những công việc nào đã thay đổi từ 01/10 đến 04/10/2026?', requirements: ['distinct cards', 'VN inclusive last day'], plans: [{ tool: 'query_activities', input: { range, mode: 'CHANGED_CARDS' } }], expected: [{ total: 5, eventCount: 11, changedCardCount: 5 }] },
  { id: 'D04', split: 'dev', question: 'Lan giữ bao nhiêu việc chưa xong?', requirements: ['resolve LAN', 'OPEN default'], plans: [{ tool: 'query_tasks', input: { filters: { assigneeIds: ['$LAN'] } } }], expected: [{ total: 2 }] },
  { id: 'D05', split: 'dev', question: 'Việc chưa giao nào quá hạn?', requirements: ['unassigned intersects overdue'], plans: [{ tool: 'query_tasks', input: { filters: { assignment: 'UNASSIGNED', overdue: true } } }], expected: [{ total: 25 }] },
  { id: 'D06', split: 'dev', question: 'Mỗi cột có bao nhiêu việc chưa hoàn thành?', requirements: ['column grouping'], plans: [{ tool: 'aggregate_tasks', input: { groupBy: 'COLUMN' } }], expected: [{ totalCards: 30, total: 1 }] },
  { id: 'D07', split: 'dev', question: 'Lan đã đổi hạn trong khoảng 01/10–04/10/2026?', requirements: ['historical actor', 'due event', 'missing old value stays unknown'], plans: [{ tool: 'query_activities', input: { range, actorIds: ['$LAN'], types: ['card.due.set', 'card.due.clear'] } }], expected: [{ eventCount: 1, changedCardCount: 1 }] },
  { id: 'D08', split: 'dev', question: 'Ai giữ nhiều việc nhất nếu tính cả việc đã xong?', requirements: ['ALL completion'], plans: [{ tool: 'aggregate_tasks', input: { groupBy: 'ASSIGNEE', filters: { completion: 'ALL' } } }], expected: [{ totalCards: 31, highestCount: 3 }] },
  { id: 'T01', split: 'test', question: 'Trong bảng 1234 ai đang có số lượng công việc lớn hơn và những công việc nào chưa được chia cho các thành viên?', requirements: ['both requests', 'OPEN default', 'names before numeric IDs'], plans: [
    { tool: 'aggregate_tasks', input: { groupBy: 'ASSIGNEE' } }, { tool: 'query_tasks', input: { filters: { assignment: 'UNASSIGNED' } } },
  ], expected: [{ totalCards: 30, highestCount: 2, outsideAssignments: 1, deletedAccountAssignments: 1 }, { total: 25 }] },
  { id: 'T02', split: 'test', question: 'Có mấy việc vừa thay đổi trong kỳ 01/10–04/10/2026 đang quá hạn và chưa chia người?', requirements: ['full set intersection'], plans: [{ tool: 'query_tasks', input: { filters: { overdue: true, assignment: 'UNASSIGNED', changed: { range } } } }], expected: [{ total: 1 }] },
  { id: 'T03', split: 'test', question: 'Cho xem trang tiếp các việc chưa giao', requirements: ['previous block context', 'fresh permission check'], plans: [{ tool: 'query_tasks', input: { filters: { assignment: 'UNASSIGNED' }, page: 2 } }], expected: [{ total: 25, hasMore: false, page: 2 }] },
  { id: 'T04', split: 'test', question: 'Tuấn có những công việc nào, kể cả việc hoàn tất?', requirements: ['resolve TUAN', 'ALL'], plans: [{ tool: 'query_tasks', input: { filters: { assigneeIds: ['$TUAN'], completion: 'ALL' } } }], expected: [{ total: 3 }] },
  { id: 'T05', split: 'test', question: 'Cả bảng đã hoàn thành bao nhiêu việc ngày 04/10/2026?', requirements: ['completion time, not due date'], plans: [{ tool: 'query_tasks', input: { filters: { completion: 'DONE', date: { field: 'COMPLETED', range: { from: '2026-10-04', to: '2026-10-04' } } } } }], expected: [{ total: 1 }] },
  { id: 'T06', split: 'test', question: 'Thong ke viec cua moi nguoi', requirements: ['unaccented', 'multi-assignment rule', 'zero member'], plans: [{ tool: 'aggregate_tasks', input: { groupBy: 'ASSIGNEE' } }], expected: [{ totalCards: 30, total: 4 }] },
  { id: 'T07', split: 'test', question: 'Trong khoảng 01/10–04/10/2026, có bao nhiêu lần thay đổi và bao nhiêu công việc thay đổi?', requirements: ['events vs distinct cards'], plans: [{ tool: 'query_activities', input: { range } }], expected: [{ eventCount: 11, changedCardCount: 5 }] },
  { id: 'T08', split: 'test', question: 'Mỗi trạng thái có bao nhiêu thẻ nếu tính cả đã xong?', requirements: ['status grouping'], plans: [{ tool: 'aggregate_tasks', input: { groupBy: 'STATUS', filters: { completion: 'ALL' } } }], expected: [{ totalCards: 31, total: 2 }] },
  { id: 'T09', split: 'test', question: 'Nhật ký 01/10–04/10/2026 của các việc chưa giao?', requirements: ['current task filters with events'], plans: [{ tool: 'query_activities', input: { range, taskFilters: { assignment: 'UNASSIGNED' } } }], expected: [{ eventCount: 1, changedCardCount: 1 }] },
  { id: 'T10', split: 'test', question: 'Lan là ai trong hai người cùng tên?', requirements: ['entity ambiguity', 'do not guess'], clarification: 'ENTITY', plans: [], expected: [] },
] as const;
