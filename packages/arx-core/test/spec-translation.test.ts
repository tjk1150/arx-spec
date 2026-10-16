/**
 * The English translations of the specs keep the structure of the normative Korean text: the same
 * numbered sections in the same order, the same tables (columns and rows), the same code blocks,
 * the same count of RFC 2119 keywords in every section, and the same link targets. The Korean text
 * writes the keywords in English (spec/0.1.md section 2), so both files are counted for the English
 * words. Code blocks are byte-identical, except that a line holding Korean words is translated; such
 * a line keeps its place and the English line holds no Hangul.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type CodeBlock = { readonly lang: string; readonly lines: readonly string[] };
type Parsed = {
  readonly headings: readonly string[];
  readonly tables: readonly string[];
  readonly codeBlocks: readonly CodeBlock[];
  readonly keywordsBySection: Readonly<Record<string, Readonly<Record<string, number>>>>;
  readonly links: readonly string[];
};
type Pair = { readonly korean: string; readonly english: string; readonly koreanName: string };

const REPO_ROOT = path.resolve(__dirname, "../../..");
const PAIRS: readonly Pair[] = [
  { korean: "spec/0.1.md", english: "spec/0.1.en.md", koreanName: "0.1.md" },
  { korean: "spec/extensions/ARX_effects.md", english: "spec/extensions/ARX_effects.en.md", koreanName: "ARX_effects.md" },
];
const NOTICE_PREFIX = "This is an informative translation.";
const KEYWORDS: Readonly<Record<string, RegExp>> = {
  "MUST NOT": /\bMUST NOT\b/g,
  MUST: /\bMUST\b(?! NOT\b)/g,
  "SHOULD NOT": /\bSHOULD NOT\b/g,
  SHOULD: /\bSHOULD\b(?! NOT\b)/g,
  MAY: /\bMAY\b/g,
};
const HANGUL = /\p{Script=Hangul}/u;
const FENCE = /^```(\S*)\s*$/;
const HEADING = /^(#{2,4}) (?:(\d+(?:\.\d+)*)\.?\s)?/;
const TABLE_SEPARATOR = /^\|(?:\s*:?-+:?\s*\|)+\s*$/;
const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;
const BARE_URL = /https?:\/\/[^\s)<>`]+/g;

const readText = (relative: string) => readFileSync(path.join(REPO_ROOT, relative), "utf8");

/** Maps the English file names back to the Korean ones so both link sets compare equal. */
const toKoreanTarget = (target: string) =>
  target.replace(/(^|\/)0\.1\.en\.md/, "$10.1.md").replace(/ARX_effects\.en\.md/, "ARX_effects.md");

const countKeywords = (line: string, into: Record<string, number>) =>
  Object.entries(KEYWORDS).reduce(
    (counts, [word, pattern]) => ({ ...counts, [word]: (counts[word] ?? 0) + (line.match(pattern)?.length ?? 0) }),
    into,
  );

const parse = (text: string): Parsed => {
  const lines = text.split("\n");
  const headings: string[] = [];
  const tables: string[] = [];
  const codeBlocks: CodeBlock[] = [];
  const keywordsBySection: Record<string, Record<string, number>> = {};
  const links = new Set<string>();
  let section = "preamble";
  let openBlock: { lang: string; lines: string[] } | null = null;
  let tableIndex = -1;

  lines.forEach((line, index) => {
    keywordsBySection[section] = countKeywords(line, keywordsBySection[section] ?? {});
    for (const match of line.matchAll(MARKDOWN_LINK)) links.add(match[1] ?? "");
    for (const match of line.matchAll(BARE_URL)) links.add(match[0]);

    const fence = line.match(FENCE);
    if (openBlock) {
      if (fence && fence[1] === "") {
        codeBlocks.push(openBlock);
        openBlock = null;
      } else {
        openBlock.lines.push(line);
      }
      return;
    }
    if (fence) {
      openBlock = { lang: fence[1] ?? "", lines: [] };
      return;
    }
    const heading = line.match(HEADING);
    if (heading) {
      section = `${heading[1]} ${heading[2] ?? "-"}`;
      headings.push(section);
      return;
    }
    if (TABLE_SEPARATOR.test(line)) {
      const columns = line.split("|").length - 2;
      let rows = 0;
      while (lines[index + 1 + rows]?.startsWith("|")) rows += 1;
      tableIndex += 1;
      tables.push(`table ${tableIndex}: ${columns} columns, ${rows} rows`);
    }
  });

  return { headings, tables, codeBlocks, keywordsBySection, links: [...links].sort() };
};

const withoutNotice = (text: string) =>
  text
    .split("\n")
    .filter((line) => !line.startsWith(NOTICE_PREFIX))
    .join("\n");

describe.each(PAIRS)("$english against $korean", ({ korean, english, koreanName }) => {
  const koreanText = readText(korean);
  const englishText = readText(english);
  const ko = parse(koreanText);
  const en = parse(withoutNotice(englishText));

  it("opens with the notice that the Korean text is normative", () => {
    const opening = englishText.split("\n").slice(0, 5).join("\n");
    expect(opening).toContain(`${NOTICE_PREFIX} The Korean text ([${koreanName}](${koreanName})) is normative.`);
  });

  it("has the same numbered sections in the same order", () => {
    expect(ko.headings.length).toBeGreaterThan(5);
    expect(en.headings).toEqual(ko.headings);
  });

  it("has the same tables with the same columns and rows", () => {
    expect(ko.tables.length).toBeGreaterThan(0);
    expect(en.tables).toEqual(ko.tables);
  });

  it("has the same code blocks, translating only lines with Korean words", () => {
    expect(en.codeBlocks.map((block) => block.lang)).toEqual(ko.codeBlocks.map((block) => block.lang));
    ko.codeBlocks.forEach((block, blockIndex) => {
      const translated = en.codeBlocks[blockIndex]?.lines ?? [];
      expect(translated.length, `code block ${blockIndex} line count`).toBe(block.lines.length);
      block.lines.forEach((line, lineIndex) => {
        const englishLine = translated[lineIndex] ?? "";
        if (HANGUL.test(line)) {
          expect(HANGUL.test(englishLine), `code block ${blockIndex} line ${lineIndex} still has Hangul`).toBe(false);
        } else {
          expect(englishLine, `code block ${blockIndex} line ${lineIndex}`).toBe(line);
        }
      });
    });
  });

  it("has the same RFC 2119 keywords in every section", () => {
    expect(en.keywordsBySection).toEqual(ko.keywordsBySection);
  });

  it("links to the same targets", () => {
    expect(en.links.map(toKoreanTarget)).toEqual(ko.links);
  });

  it("links only to files that exist", () => {
    const relative = en.links.filter((target) => !/^[a-z]+:/.test(target));
    const missing = relative.filter(
      (target) => !existsSync(path.resolve(REPO_ROOT, path.dirname(english), target.split("#")[0] ?? "")),
    );
    expect(missing).toEqual([]);
  });

  it("has no Korean text left", () => {
    const leftover = englishText.split("\n").filter((line) => HANGUL.test(line));
    expect(leftover).toEqual([]);
  });
});
