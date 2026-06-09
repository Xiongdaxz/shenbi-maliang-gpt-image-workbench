import type { ReactNode } from "react";
import { cx } from "../lib/cx";

type MarkdownViewProps = {
  markdown: string;
  className?: string;
};

const inlinePattern = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|\*[^*]+\*)/g;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(inlinePattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));

    const key = `${keyPrefix}-${index}`;
    if (token.startsWith("`")) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{renderInline(token.slice(2, -2), `${key}-bold`)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{renderInline(token.slice(1, -1), `${key}-em`)}</em>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
      nodes.push(
        link ? (
          <a key={key} href={link[2]} target="_blank" rel="noreferrer">
            {link[1]}
          </a>
        ) : (
          token
        )
      );
    }
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function isBlockStart(line: string) {
  return (
    /^#{1,4}\s+/.test(line) ||
    /^>\s?/.test(line) ||
    /^[-*+]\s+/.test(line) ||
    /^\d+\.\s+/.test(line) ||
    /^```/.test(line)
  );
}

function renderBlocks(markdown: string) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    if (trimmed.startsWith("```")) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].trim().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(
        <pre key={`code-${index}`}>
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = renderInline(heading[2].trim(), `heading-${index}`);
      blocks.push(
        level <= 1 ? (
          <h2 key={`heading-${index}`}>{content}</h2>
        ) : level === 2 ? (
          <h3 key={`heading-${index}`}>{content}</h3>
        ) : (
          <h4 key={`heading-${index}`}>{content}</h4>
        )
      );
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const quoteLines: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={`quote-${index}`}>{renderBlocks(quoteLines.join("\n"))}</blockquote>);
      continue;
    }

    if (/^[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*+]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^[-*+]\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ul key={`ul-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `ul-${index}-${itemIndex}`)}</li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(
        <ol key={`ol-${index}`}>
          {items.map((item, itemIndex) => (
            <li key={itemIndex}>{renderInline(item, `ol-${index}-${itemIndex}`)}</li>
          ))}
        </ol>
      );
      continue;
    }

    const paragraphLines: string[] = [trimmed];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push(<p key={`p-${index}`}>{renderInline(paragraphLines.join(" "), `p-${index}`)}</p>);
  }

  return blocks;
}

export function MarkdownView({ markdown, className }: MarkdownViewProps) {
  return <div className={cx("markdown-view", className)}>{renderBlocks(markdown)}</div>;
}
