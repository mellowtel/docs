#!/usr/bin/env npx ts-node
/**
 * Generates a complete sitemap.xml with hreflang alternates.
 *
 * Mintlify serves a root-level sitemap.xml as-is, overriding its generated
 * sitemap. Run this after translations and locale SEO normalization.
 *
 * Usage:
 *   npx ts-node scripts/generate-hreflang-sitemap.ts
 *   npx ts-node scripts/generate-hreflang-sitemap.ts --validate-only
 */

import * as fs from "fs";
import * as path from "path";
import { parseDocument } from "yaml";
import { LANGUAGES } from "./languages";

const DOCS_ROOT = path.resolve(__dirname, "..");
const DOCS_CONFIG_PATH = path.join(DOCS_ROOT, "docs.json");
const SITEMAP_PATH = path.join(DOCS_ROOT, "sitemap.xml");
const SITE_ROOT = "https://mellowtel.com/docs";

const HREFLANG_CODES: Record<string, string> = {
  en: "en",
  zh: "zh-Hans",
  ar: "ar-DZ",
};

interface NavGroup {
  group?: string;
  pages?: NavPage[];
  hidden?: boolean;
}

interface NavTab {
  tab?: string;
  groups?: NavGroup[];
  hidden?: boolean;
}

type NavPage = string | NavGroup;

interface LanguageNavConfig {
  language?: string;
  default?: boolean;
  tabs?: NavTab[];
}

interface DocsConfig {
  navigation?: {
    tabs?: NavTab[];
    languages?: LanguageNavConfig[];
  };
}

interface LocaleVersion {
  locale: string;
  hreflang: string;
  file: string;
  url: string;
}

function normalizePagePath(page: string): string {
  let normalized = page.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.mdx$/, "");

  for (const locale of Object.keys(LANGUAGES)) {
    if (normalized === locale || normalized.startsWith(`${locale}/`)) {
      normalized = normalized.slice(locale.length).replace(/^\/+/, "");
      break;
    }
  }

  return normalized;
}

function getEnglishTabs(config: DocsConfig): NavTab[] {
  if (config.navigation?.tabs?.length) {
    return config.navigation.tabs;
  }

  const languages = config.navigation?.languages;
  if (Array.isArray(languages)) {
    const english = languages.find((language) => language.language === "en" || language.default);
    if (english?.tabs?.length) {
      return english.tabs;
    }
  }

  return [];
}

function collectPagesFromGroup(group: NavGroup, pages: string[]): void {
  if (group.hidden || !Array.isArray(group.pages)) {
    return;
  }

  for (const page of group.pages) {
    if (typeof page === "string") {
      pages.push(normalizePagePath(page));
    } else {
      collectPagesFromGroup(page, pages);
    }
  }
}

function getNavigationPages(): string[] {
  const config = JSON.parse(fs.readFileSync(DOCS_CONFIG_PATH, "utf8")) as DocsConfig;
  const tabs = getEnglishTabs(config);
  const pages: string[] = [];

  for (const tab of tabs) {
    if (tab.hidden || !Array.isArray(tab.groups)) {
      continue;
    }
    for (const group of tab.groups) {
      collectPagesFromGroup(group, pages);
    }
  }

  return [...new Set(pages)].filter(Boolean);
}

function splitFrontmatter(content: string): string | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return match?.[1] ?? null;
}

function isIndexableMdx(file: string): boolean {
  if (!fs.existsSync(file)) {
    return false;
  }

  const frontmatter = splitFrontmatter(fs.readFileSync(file, "utf8"));
  if (!frontmatter) {
    return true;
  }

  const parsed = parseDocument(frontmatter);
  if (parsed.errors.length > 0) {
    throw new Error(
      `${path.relative(DOCS_ROOT, file)} has invalid frontmatter: ${parsed.errors
        .map((error) => error.message)
        .join("; ")}`
    );
  }

  const data = parsed.toJS() as Record<string, unknown>;
  if (data.hidden === true || data.noindex === true) {
    return false;
  }

  if (typeof data.robots === "string" && /\bnoindex\b/i.test(data.robots)) {
    return false;
  }

  return true;
}

function getPageFile(locale: string, pagePath: string): string {
  const localePrefix = locale === "en" ? "" : locale;
  return path.join(DOCS_ROOT, localePrefix, `${pagePath}.mdx`);
}

function getPageUrl(locale: string, pagePath: string): string {
  const localePrefix = locale === "en" ? "" : `/${locale}`;
  return `${SITE_ROOT}${localePrefix}/${pagePath}`;
}

function getHreflang(locale: string): string {
  return HREFLANG_CODES[locale] ?? locale;
}

function getLocaleVersions(pagePath: string): LocaleVersion[] {
  const locales = ["en", ...Object.keys(LANGUAGES)];
  const versions: LocaleVersion[] = [];

  for (const locale of locales) {
    const file = getPageFile(locale, pagePath);
    if (!isIndexableMdx(file)) {
      continue;
    }

    versions.push({
      locale,
      hreflang: getHreflang(locale),
      file,
      url: getPageUrl(locale, pagePath),
    });
  }

  return versions;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function renderUrl(version: LocaleVersion, alternates: LocaleVersion[]): string {
  const english = alternates.find((alternate) => alternate.locale === "en");
  if (!english) {
    throw new Error(`Missing English x-default URL for ${version.url}`);
  }

  const alternateLinks = [
    ...alternates.map(
      (alternate) =>
        `    <xhtml:link rel="alternate" hreflang="${escapeXml(
          alternate.hreflang
        )}" href="${escapeXml(alternate.url)}" />`
    ),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeXml(
      english.url
    )}" />`,
  ].join("\n");

  return [
    "  <url>",
    `    <loc>${escapeXml(version.url)}</loc>`,
    alternateLinks,
    "  </url>",
  ].join("\n");
}

function generateSitemap(): string {
  const pages = getNavigationPages();
  if (pages.length === 0) {
    throw new Error("No navigation pages found in docs.json");
  }

  const urls: string[] = [];
  const skippedPages: string[] = [];

  for (const page of pages) {
    const versions = getLocaleVersions(page);
    if (versions.length === 0 || !versions.some((version) => version.locale === "en")) {
      skippedPages.push(page);
      continue;
    }

    for (const version of versions) {
      urls.push(renderUrl(version, versions));
    }
  }

  if (skippedPages.length > 0) {
    console.warn(`Skipped ${skippedPages.length} navigation pages with no indexable English file:`);
    console.warn(skippedPages.map((page) => `  - ${page}`).join("\n"));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls.join("\n\n"),
    "</urlset>",
    "",
  ].join("\n");
}

function validateSitemap(content: string): string[] {
  const errors: string[] = [];
  const urlCount = (content.match(/<url>/g) ?? []).length;
  const locCount = (content.match(/<loc>/g) ?? []).length;
  const hreflangCount = (content.match(/hreflang=/g) ?? []).length;

  if (!content.includes('xmlns:xhtml="http://www.w3.org/1999/xhtml"')) {
    errors.push("missing xhtml namespace");
  }
  if (urlCount === 0) {
    errors.push("no URL entries generated");
  }
  if (urlCount !== locCount) {
    errors.push(`URL entry count (${urlCount}) does not match loc count (${locCount})`);
  }
  if (hreflangCount === 0) {
    errors.push("no hreflang links generated");
  }
  if (content.includes("https://www.mellowtel.com/docs")) {
    errors.push("contains www docs URLs");
  }

  return errors;
}

function main(): void {
  const validateOnly = process.argv.includes("--validate-only");
  const content = validateOnly && fs.existsSync(SITEMAP_PATH)
    ? fs.readFileSync(SITEMAP_PATH, "utf8")
    : generateSitemap();
  const errors = validateSitemap(content);

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  if (!validateOnly) {
    fs.writeFileSync(SITEMAP_PATH, content, "utf8");
  }

  const urlCount = (content.match(/<url>/g) ?? []).length;
  const hreflangCount = (content.match(/hreflang=/g) ?? []).length;
  const action = validateOnly ? "Validated" : "Generated";
  console.log(`${action} sitemap.xml with ${urlCount} URLs and ${hreflangCount} hreflang links.`);
}

if (require.main === module) {
  main();
}
