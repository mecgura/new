import { modernMedical } from "./modern-medical";
import type { TemplateDefinition } from "./types";

/** Add future templates (Dental, Skin & Aesthetic, Physiotherapy …) here. */
export const TEMPLATES: Record<string, TemplateDefinition> = { [modernMedical.key]: modernMedical };
export const DEFAULT_TEMPLATE = modernMedical.key;
export const getTemplate = (key: string | null | undefined): TemplateDefinition => TEMPLATES[key ?? ""] ?? TEMPLATES[DEFAULT_TEMPLATE];
export const templateList = () => Object.values(TEMPLATES).map(({ key, name, description }) => ({ key, name, description }));
