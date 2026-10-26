import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import zh from "./zh.json";
export type Language = "en" | "zh";
const dictionary = zh as Record<string, string>;
const normalize = (text: string) => text.replace(/\s+/g, " ").toLowerCase();
const folded = Object.fromEntries(Object.entries(dictionary).map(([key,value])=>[normalize(key),value]));
export function translate<T>(value: T, language: Language): T {
  if (language === "en" || typeof value !== "string") return value;
  const key = value.trim();
  let result = dictionary[key] ?? folded[normalize(key)];
  if (!result && /^\d+ \/ /.test(key)) result = key.replace(/SYSTEM|FRAME|CUSHION|GLIDE|STABILITY|CONTROL|POWER|STRUCTURE/g, word => ({SYSTEM:"系统",FRAME:"骨架",CUSHION:"缓冲",GLIDE:"滑动",STABILITY:"稳定",CONTROL:"约束",POWER:"动力",STRUCTURE:"结构"})[word]!);
  if (!result && key.startsWith("Choose an individual ")) result = "选择单个" + (key.endsWith("ligament") ? "韧带" : "肌肉");
  if (!result && key.startsWith("Applied force versus anterior displacement.")) result = key.replace("Applied force versus anterior displacement. At", "施加拉力与胫骨前移：").replace("newtons: intact", "牛顿时，完整 ACL").replace("millimetres, torn", "毫米，断裂 ACL").replace("millimetres.", "毫米。");
  return (result ? value.replace(key, result) : value) as T;
}
const LanguageContext = createContext({ language: "en" as Language, setLanguage: (_language: Language) => {}, t: <T,>(value: T): T => value });
export function LanguageProvider({children}: {children: ReactNode}) {
  const [language, setLanguage] = useState<Language>(() => {
    try { return localStorage.getItem("knee-lab-language") === "zh" ? "zh" : "en"; } catch { return "en"; }
  });
  useEffect(() => {
    document.documentElement.lang = language === "en" ? "en" : "zh-CN";
    document.title = language === "en" ? "Knee Lab — Anatomy in Motion" : "Knee Lab — 运动中的膝关节解剖";
    try { localStorage.setItem("knee-lab-language", language); } catch { /* Storage may be unavailable. */ }
  }, [language]);
  return <LanguageContext.Provider value={{language,setLanguage,t: <T,>(value: T) => translate(value, language)}}>{children}</LanguageContext.Provider>;
}
export function useLanguage() { return useContext(LanguageContext); }
export function LanguageToggle() {
  const {language,setLanguage} = useLanguage();
  return <button type="button" className="language-toggle" onClick={() => setLanguage(language === "en" ? "zh" : "en")} aria-label={language === "en" ? "Switch to Chinese" : "切换至英文"}><span lang="en" className={language === "en" ? "is-selected" : ""}>EN</span><span aria-hidden="true">/</span><span lang="zh-CN" className={language === "zh" ? "is-selected" : ""}>中文</span></button>;
}
