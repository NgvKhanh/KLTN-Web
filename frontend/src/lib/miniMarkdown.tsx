import { Fragment, type ReactNode } from 'react';

/**
 * Trinh dung Markdown toi gian, an toan (khong dung dangerouslySetInnerHTML).
 * Ho tro: tieu de #/##/###, **dam**, *nghieng*, `ma`, [chu](lien-ket),
 * danh sach - / * / 1., trich dan >, dong trong -> doan moi.
 */

// ----- Inline: **dam**, *nghieng*, `code`, [text](url) -----
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(_([^_]+)_)|(`([^`]+)`)|(\[([^\]]+)\]\(([^)]+)\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const key = `${keyBase}-${i++}`;
    if (m[2] !== undefined) {
      nodes.push(<strong key={key}>{m[2]}</strong>);
    } else if (m[4] !== undefined) {
      nodes.push(<em key={key}>{m[4]}</em>);
    } else if (m[6] !== undefined) {
      nodes.push(<em key={key}>{m[6]}</em>);
    } else if (m[8] !== undefined) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-slate-200 px-1 py-0.5 text-[0.85em] text-slate-800 dark:bg-slate-700 dark:text-slate-100"
        >
          {m[8]}
        </code>
      );
    } else if (m[10] !== undefined && m[11] !== undefined) {
      const href = m[11].trim();
      const safe = /^(https?:|mailto:)/i.test(href);
      nodes.push(
        safe ? (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary-ink hover:underline"
          >
            {m[10]}
          </a>
        ) : (
          <Fragment key={key}>{m[10]}</Fragment>
        )
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let key = 0;

  const flushPara = () => {
    if (para.length === 0) return;
    const joined = para.join('\n');
    blocks.push(
      <p key={`p-${key++}`} className="whitespace-pre-wrap">
        {joined.split('\n').map((ln, idx, arr) => (
          <Fragment key={idx}>
            {renderInline(ln, `p-${key}-${idx}`)}
            {idx < arr.length - 1 && <br />}
          </Fragment>
        ))}
      </p>
    );
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items;
    blocks.push(
      list.ordered ? (
        <ol key={`l-${key++}`} className="ml-5 list-decimal space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li-${key}-${idx}`)}</li>
          ))}
        </ol>
      ) : (
        <ul key={`l-${key++}`} className="ml-5 list-disc space-y-0.5">
          {items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `li-${key}-${idx}`)}</li>
          ))}
        </ul>
      )
    );
    list = null;
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    const quote = /^>\s?(.*)$/.exec(line);

    if (heading) {
      flushPara();
      flushList();
      const level = heading[1]!.length;
      const cls =
        level === 1
          ? 'text-base font-bold'
          : level === 2
            ? 'text-sm font-bold'
            : 'text-sm font-semibold';
      blocks.push(
        <p key={`h-${key++}`} className={cls}>
          {renderInline(heading[2]!, `h-${key}`)}
        </p>
      );
    } else if (ul) {
      flushPara();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(ul[1]!);
    } else if (ol) {
      flushPara();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ol[1]!);
    } else if (quote) {
      flushPara();
      flushList();
      blocks.push(
        <p
          key={`q-${key++}`}
          className="border-l-4 border-slate-300 pl-2 text-slate-600 dark:border-slate-600 dark:text-slate-300"
        >
          {renderInline(quote[1]!, `q-${key}`)}
        </p>
      );
    } else if (line.trim() === '') {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();

  return (
    <div className="flex flex-col gap-2 text-sm text-slate-700 dark:text-slate-200">
      {blocks}
    </div>
  );
}
