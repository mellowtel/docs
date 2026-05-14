export interface LanguageInfo {
  name: string;
  nativeName: string;
}

export const LANGUAGES: Record<string, LanguageInfo> = {
  de: { name: "German", nativeName: "Deutsch" },
  fr: { name: "French", nativeName: "Français" },
  es: { name: "Spanish", nativeName: "Español" },
  nl: { name: "Dutch", nativeName: "Nederlands" },
  zh: { name: "Chinese (Simplified)", nativeName: "简体中文" },
  it: { name: "Italian", nativeName: "Italiano" },
  ja: { name: "Japanese", nativeName: "日本語" },
  ru: { name: "Russian", nativeName: "Русский" },
};
