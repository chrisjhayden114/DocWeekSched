import type { ReactNode } from "react";

const URL_RE = /(https?:\/\/[^\s<]+[^.,;:!?\s<])/gi;

/** Render text with http(s) URLs as links (opens in new tab). */
export function AutolinkText({ text, className }: { text: string; className?: string }) {
  const nodes: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(URL_RE);
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const href = match[0];
    nodes.push(
      <a key={`${match.index}-${href}`} href={href} target="_blank" rel="noopener noreferrer">
        {href}
      </a>,
    );
    last = match.index + href.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return <span className={className}>{nodes.length ? nodes : text}</span>;
}
