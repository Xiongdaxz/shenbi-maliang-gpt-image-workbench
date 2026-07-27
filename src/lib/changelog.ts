const MARKDOWN_HEADING = /^(#{1,6})\s+/;
const ENGLISH_SECTION_HEADING = /^(#{1,3})\s+(?:english|英文)\s*#*\s*$/i;
const LANGUAGE_SECTION_HEADING = /^(#{1,3})\s+(中文|chinese|english|英文)\s*#*\s*$/i;

function languageSection(line: string) {
  const match = LANGUAGE_SECTION_HEADING.exec(line.trim());
  if (!match) return null;
  const label = match[2].toLocaleLowerCase();
  return label === "中文" || label === "chinese" ? "zh" : "en";
}

export function changelogContentForSync(markdown: string, includeEnglish: boolean) {
  const visibleLines: string[] = [];
  let hiddenHeadingLevel = 0;

  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = line.trim();
    const englishHeading = ENGLISH_SECTION_HEADING.exec(trimmed);
    if (!includeEnglish && englishHeading) {
      hiddenHeadingLevel = englishHeading[1].length;
      continue;
    }

    if (hiddenHeadingLevel > 0) {
      const nextHeading = MARKDOWN_HEADING.exec(trimmed);
      if (!nextHeading || nextHeading[1].length > hiddenHeadingLevel) continue;
      hiddenHeadingLevel = 0;
    }

    visibleLines.push(line);
  }

  const languages = new Set(visibleLines.map(languageSection).filter(Boolean));
  const contentLines = languages.size === 1
    ? visibleLines.filter((line) => !languageSection(line))
    : visibleLines;

  return contentLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
