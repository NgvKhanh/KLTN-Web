import type { BoardPlan, PlanCard, PlanMode } from '../../types/ai';
import { BOARD_COLORS } from '../../lib/boardColors';
import {
  ORIGIN_LABEL,
  PLAN_INPUT_LIMITS,
  countSelected,
  setBoardColor,
  setBoardName,
  setCardDate,
  setCardSelected,
  setCardTitle,
  setListName,
  setListSelected,
  warningsForCard,
  type PlanDateField,
  type PlanIssue,
} from '../../lib/aiPlan';

interface Props {
  plan: BoardPlan;
  onChange: (plan: BoardPlan) => void;
  issues: PlanIssue[];
  /** Ke hoach do LLM (true) hay chi do bo luat (false). */
  llmUsed: boolean;
  /** Che do do MAY chon; plan.mode la che do thuc su dung. */
  modeAuto: PlanMode;
  disabled?: boolean;
}

const MODE_LABEL: Record<PlanMode, string> = {
  STRUCTURED: 'Có cấu trúc',
  FREEFORM: 'Văn xuôi',
};

const field =
  'w-full rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-60 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';
const smallLabel = 'mb-0.5 flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400';

function DateField({
  card,
  which,
  label,
  disabled,
  onChange,
}: {
  card: PlanCard;
  which: PlanDateField;
  label: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const value = card[which];
  const origin = which === 'startDate' ? card.startOrigin : card.dueOrigin;
  return (
    <label className="flex min-w-0 flex-col gap-0.5">
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 dark:text-slate-400">
        {label}
        {value !== null && ORIGIN_LABEL[origin] !== '' && (
          <span
            className={`rounded px-1 py-px text-[10px] ${
              origin === 'EXPLICIT'
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
            }`}
          >
            {ORIGIN_LABEL[origin]}
          </span>
        )}
      </span>
      <input
        type="date"
        aria-label={label}
        value={value ?? ''}
        min="1970-01-01"
        max="2100-12-31"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className={`${field} font-normal`}
      />
    </label>
  );
}

function CardRow({
  plan,
  card,
  issues,
  disabled,
  onChange,
}: {
  plan: BoardPlan;
  card: PlanCard;
  issues: PlanIssue[];
  disabled?: boolean;
  onChange: (plan: BoardPlan) => void;
}) {
  const labels = card.labelKeys
    .map((k) => plan.labels.find((l) => l.key === k))
    .filter((l): l is NonNullable<typeof l> => Boolean(l));
  const warnings = warningsForCard(plan, card.ref);
  const cardIssues = issues.filter((i) => i.scope === 'card' && i.ref === card.ref);

  return (
    <li
      data-testid={`plan-card-${card.ref}`}
      className={`rounded-lg border p-2.5 ${
        card.selected
          ? 'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800'
          : 'border-dashed border-slate-300 bg-slate-50 opacity-70 dark:border-slate-600 dark:bg-slate-800/40'
      }`}
    >
      <div className="flex items-start gap-2">
        <input
          type="checkbox"
          aria-label="Chọn thẻ"
          checked={card.selected}
          disabled={disabled}
          onChange={(e) => onChange(setCardSelected(plan, card.ref, e.target.checked))}
          className="mt-2 h-4 w-4 shrink-0 accent-primary"
        />
        <div className="min-w-0 flex-1">
          <input
            aria-label="Tiêu đề thẻ"
            value={card.title}
            maxLength={PLAN_INPUT_LIMITS.cardTitle}
            disabled={disabled}
            onChange={(e) => onChange(setCardTitle(plan, card.ref, e.target.value))}
            className={field}
          />

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400">
            {card.sourceLine === null ? (
              <span className="rounded bg-violet-100 px-1.5 py-px text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">
                AI thêm
              </span>
            ) : (
              <span>Dòng {card.sourceLine}</span>
            )}
            {labels.map((l) => (
              <span
                key={l.key}
                className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-1.5 py-px dark:border-slate-600"
              >
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: l.color }} />
                {l.name}
              </span>
            ))}
            {card.checklist.length > 0 && <span>Checklist: {card.checklist.length} mục</span>}
          </div>

          {card.description !== '' && (
            <p className="mt-1 line-clamp-2 text-xs text-slate-500 dark:text-slate-400">{card.description}</p>
          )}

          <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <DateField
              card={card}
              which="startDate"
              label="Ngày bắt đầu"
              disabled={disabled}
              onChange={(v) => onChange(setCardDate(plan, card.ref, 'startDate', v))}
            />
            <DateField
              card={card}
              which="dueDate"
              label="Hạn chót"
              disabled={disabled}
              onChange={(v) => onChange(setCardDate(plan, card.ref, 'dueDate', v))}
            />
          </div>

          {warnings.map((w, i) => (
            <p key={i} className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400">
              ⚠ {w.message}
            </p>
          ))}
          {cardIssues.map((i, k) => (
            <p key={k} role="alert" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
              {i.message}
            </p>
          ))}
        </div>
      </div>
    </li>
  );
}

export default function AiPlanEditor({ plan, onChange, issues, llmUsed, modeAuto, disabled }: Props) {
  const warnings = plan.warnings.filter((w) => !w.ref);
  const boardIssues = issues.filter((i) => i.scope === 'board');

  return (
    <div className="flex flex-col gap-4">
      {/* Nguon ke hoach + che do */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`rounded-full px-2 py-0.5 font-medium ${
            llmUsed
              ? 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300'
              : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
          }`}
        >
          {llmUsed ? 'Kế hoạch do AI' : 'Kế hoạch từ bộ luật (không dùng AI)'}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600 dark:bg-slate-700 dark:text-slate-300">
          Chế độ: {MODE_LABEL[plan.mode]}
          {plan.mode !== modeAuto ? ' (bạn đã chọn)' : ' (tự nhận diện)'}
        </span>
        <span className="text-slate-500 dark:text-slate-400">Đã chọn {countSelected(plan)} thẻ</span>
      </div>

      {warnings.length > 0 && (
        <details open={warnings.length <= 3} className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 dark:border-amber-800/60 dark:bg-amber-900/20 dark:text-amber-200">
          <summary className="cursor-pointer font-medium">Lưu ý ({warnings.length})</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {warnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </details>
      )}

      {plan.assumptions.length > 0 && (
        <details className="rounded-lg border border-slate-200 p-2.5 text-xs text-slate-600 dark:border-slate-700 dark:text-slate-300">
          <summary className="cursor-pointer font-medium">Hệ thống đã giả định ({plan.assumptions.length})</summary>
          <ul className="mt-1.5 list-disc space-y-1 pl-4">
            {plan.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </details>
      )}

      {/* Bang */}
      <section aria-label="Thông tin bảng" className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
        <label className={smallLabel} htmlFor="ai-plan-board-name">
          Tên bảng
        </label>
        <input
          id="ai-plan-board-name"
          value={plan.board.name}
          maxLength={PLAN_INPUT_LIMITS.boardName}
          disabled={disabled}
          onChange={(e) => onChange(setBoardName(plan, e.target.value))}
          className={field}
        />
        {boardIssues.map((i, k) => (
          <p key={k} role="alert" className="mt-1 text-xs font-medium text-red-600 dark:text-red-400">
            {i.message}
          </p>
        ))}
        <p className={`${smallLabel} mt-2.5`}>Màu nền</p>
        <div className="flex flex-wrap gap-1.5">
          {BOARD_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Màu bảng ${c}`}
              aria-pressed={plan.board.color === c}
              disabled={disabled}
              onClick={() => onChange(setBoardColor(plan, c))}
              className={`h-6 w-9 rounded ${plan.board.color === c ? 'ring-2 ring-slate-800 ring-offset-1 dark:ring-white' : ''}`}
              style={{ backgroundColor: c }}
            />
          ))}
        </div>
      </section>

      {/* Danh sach + the */}
      {plan.lists.map((list, listIndex) => {
        const selected = list.cards.filter((c) => c.selected).length;
        const listIssues = issues.filter((i) => i.scope === 'list' && i.listIndex === listIndex);
        return (
          <section key={listIndex} aria-label={`Danh sách ${listIndex + 1}`} className="rounded-lg bg-slate-100/70 p-2.5 dark:bg-slate-900/40">
            <div className="mb-2 flex items-center gap-2">
              <input
                aria-label="Tên danh sách"
                value={list.name}
                maxLength={PLAN_INPUT_LIMITS.listName}
                disabled={disabled}
                onChange={(e) => onChange(setListName(plan, listIndex, e.target.value))}
                className={`${field} font-semibold`}
              />
              <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">
                {selected}/{list.cards.length}
              </span>
              <button
                type="button"
                disabled={disabled || list.cards.length === 0}
                onClick={() => onChange(setListSelected(plan, listIndex, selected !== list.cards.length))}
                className="shrink-0 rounded px-2 py-1 text-xs font-medium text-primary-ink hover:bg-white disabled:opacity-50 dark:hover:bg-slate-800"
              >
                {selected === list.cards.length ? 'Bỏ chọn hết' : 'Chọn hết'}
              </button>
            </div>
            {listIssues.map((i, k) => (
              <p key={k} role="alert" className="mb-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {i.message}
              </p>
            ))}
            {list.cards.length === 0 ? (
              <p className="px-1 py-2 text-xs text-slate-500 dark:text-slate-400">Danh sách này chưa có thẻ nào.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {list.cards.map((card) => (
                  <CardRow
                    key={card.ref}
                    plan={plan}
                    card={card}
                    issues={issues}
                    disabled={disabled}
                    onChange={onChange}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
