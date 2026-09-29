/**
 * Long page text from the string tables, as elements (never innerHTML): blank lines split blocks; a block
 * starting "## " is a heading (the lines under it follow the same rules); lines starting "- " are a list,
 * "1. " a numbered list; **bold** and `code` work inside a line.
 */
import { Fragment, type ReactNode } from 'react';

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let at = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > at) out.push(text.slice(at, m.index));
    out.push(m[1] !== undefined ? <strong key={i++}>{m[1]}</strong> : <code key={i++}>{m[2]}</code>);
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

function body(lines: string[]): ReactNode {
  if (lines.every((l) => l.startsWith('- '))) {
    return (
      <ul>
        {lines.map((l, j) => (
          <li key={j}>{inline(l.slice(2))}</li>
        ))}
      </ul>
    );
  }
  if (lines.every((l) => /^\d+\. /.test(l))) {
    return (
      <ol>
        {lines.map((l, j) => (
          <li key={j}>{inline(l.replace(/^\d+\. /, ''))}</li>
        ))}
      </ol>
    );
  }
  return <p>{inline(lines.join(' '))}</p>;
}

export function Prose({ text, headingLevel = 3 }: { text: string; headingLevel?: 2 | 3 | 4 }) {
  const blocks = text.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  const H = `h${headingLevel}` as 'h2' | 'h3' | 'h4';
  return (
    <>
      {blocks.map((block, i) => {
        const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
        if (lines[0].startsWith('## ')) {
          const rest = lines.slice(1);
          return (
            <Fragment key={i}>
              <H className="page__h">{inline(lines[0].slice(3))}</H>
              {rest.length > 0 && body(rest)}
            </Fragment>
          );
        }
        return <Fragment key={i}>{body(lines)}</Fragment>;
      })}
    </>
  );
}
