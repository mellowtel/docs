#!/usr/bin/env npx ts-node
/**
 * Normalizes locale-aware SEO URLs in English and translated MDX files.
 *
 * Mintlify does not rewrite canonical frontmatter for pages nested under a
 * language directory. This script runs after translation so every rendered
 * page has a self-referencing canonical and matching Open Graph URL.
 *
 * Usage:
 *   npx ts-node scripts/update-locale-seo.ts
 *   npx ts-node scripts/update-locale-seo.ts --validate-only
 */

import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "yaml";
import { LANGUAGES } from "./languages";

const DOCS_ROOT = path.resolve(__dirname, "..");
const SITE_ROOT = "https://mellowtel.com/docs";
const SKIP_DIRS = new Set([
  ".git",
  ".github",
  "node_modules",
  "scripts",
  "snippets",
  ...Object.keys(LANGUAGES),
]);

interface SeoTarget {
  file: string;
  locale: string;
  pagePath: string;
}

function walkMdx(dir: string, out: string[], skipDirs: Set<string> = new Set()): void {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && skipDirs.has(entry.name)) {
      continue;
    }

    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMdx(entryPath, out, skipDirs);
    } else if (entry.name.endsWith(".mdx")) {
      out.push(entryPath);
    }
  }
}

function toPagePath(root: string, file: string): string {
  return path.relative(root, file).replace(/\\/g, "/").replace(/\.mdx$/, "");
}

function getSeoTargets(root: string): SeoTarget[] {
  const targets: SeoTarget[] = [];
  const englishFiles: string[] = [];
  walkMdx(root, englishFiles, SKIP_DIRS);

  for (const file of englishFiles) {
    targets.push({ file, locale: "en", pagePath: toPagePath(root, file) });
  }

  for (const locale of Object.keys(LANGUAGES)) {
    const localeRoot = path.join(root, locale);
    const localeFiles: string[] = [];
    walkMdx(localeRoot, localeFiles);

    for (const file of localeFiles) {
      targets.push({ file, locale, pagePath: toPagePath(localeRoot, file) });
    }
  }

  return targets;
}

export function getCanonicalUrl(locale: string, pagePath: string): string {
  const localePrefix = locale === "en" ? "" : `/${locale}`;
  return `${SITE_ROOT}${localePrefix}/${pagePath}`;
}

function splitFrontmatter(content: string): {
  frontmatter: string;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*)$/);
  if (!match) {
    throw new Error("missing or malformed frontmatter");
  }

  return { frontmatter: match[1], body: match[2] };
}

function setFrontmatterValue(
  frontmatter: string,
  key: string,
  value: string,
  insertAfter: string[]
): string {
  const newline = frontmatter.includes("\r\n") ? "\r\n" : "\n";
  const lines = frontmatter.split(/\r?\n/);
  const keyPattern = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`);
  const existingIndex = lines.findIndex((line) => keyPattern.test(line));
  const rendered = `${key}: ${JSON.stringify(value)}`;

  if (existingIndex >= 0) {
    lines[existingIndex] = rendered;
    return lines.join(newline);
  }

  for (const anchor of insertAfter) {
    const anchorPattern = new RegExp(
      `^${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s*`
    );
    const anchorIndex = lines.findIndex((line) => anchorPattern.test(line));
    if (anchorIndex >= 0) {
      lines.splice(anchorIndex + 1, 0, rendered);
      return lines.join(newline);
    }
  }

  lines.push(rendered);
  return lines.join(newline);
}

export function updateSeoFrontmatter(
  content: string,
  canonicalUrl: string
): string {
  const { frontmatter, body } = splitFrontmatter(content);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const parsed = parseDocument(frontmatter);
  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors.map((error) => error.message).join("; "));
  }

  let updated = setFrontmatterValue(
    frontmatter,
    "canonical",
    canonicalUrl,
    ["robots", "description", "title"]
  );
  updated = setFrontmatterValue(
    updated,
    "og:url",
    canonicalUrl,
    ["og:description", "og:title", "canonical"]
  );

  return `---${newline}${updated}${newline}---${body}`;
}

function validateSeo(content: string, canonicalUrl: string): string[] {
  const errors: string[] = [];

  try {
    const { frontmatter } = splitFrontmatter(content);
    const parsed = parseDocument(frontmatter);
    if (parsed.errors.length > 0) {
      return parsed.errors.map((error) => error.message);
    }

    const data = parsed.toJS() as Record<string, unknown>;
    if (data.canonical !== canonicalUrl) {
      errors.push(`canonical is ${JSON.stringify(data.canonical)}`);
    }
    if (data["og:url"] !== canonicalUrl) {
      errors.push(`og:url is ${JSON.stringify(data["og:url"])}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  return errors;
}

async function main(): Promise<void> {
  const validateOnly = process.argv.includes("--validate-only");
  const targets = getSeoTargets(DOCS_ROOT);
  let changed = 0;
  const failures: string[] = [];

  for (const target of targets) {
    const canonicalUrl = getCanonicalUrl(target.locale, target.pagePath);
    const content = fs.readFileSync(target.file, "utf8");

    if (validateOnly) {
      const errors = validateSeo(content, canonicalUrl);
      if (errors.length > 0) {
        failures.push(
          `${path.relative(DOCS_ROOT, target.file)}: ${errors.join(", ")}`
        );
      }
      continue;
    }

    try {
      const updated = updateSeoFrontmatter(content, canonicalUrl);
      if (updated !== content) {
        fs.writeFileSync(target.file, updated, "utf8");
        changed++;
      }
    } catch (error) {
      failures.push(
        `${path.relative(DOCS_ROOT, target.file)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  const action = validateOnly ? "Validated" : "Updated";
  console.log(
    `${action} ${targets.length} pages across English and ${
      Object.keys(LANGUAGES).length
    } translated locales${validateOnly ? "" : ` (${changed} changed)`}.`
  );

  if (failures.length > 0) {
    console.error(failures.slice(0, 30).join("\n"));
    if (failures.length > 30) {
      console.error(`...and ${failures.length - 30} more failures`);
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
