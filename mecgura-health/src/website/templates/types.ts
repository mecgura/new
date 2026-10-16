import type { ComponentType, ReactNode } from "react";
import type { PublicArticle, PublicArticleCard, PublicDoctor, PublicService, SiteData } from "@/lib/website/types";

/** What every page of every template receives. `basePath` is "" on the public site and "/preview" in the CMS preview. */
export interface BaseProps { site: SiteData; basePath: string }

/**
 * A website template = one Layout + one component per page. New templates implement this interface and are
 * registered in registry.ts — the CMS, data loading, SEO and routing do not change.
 */
export interface TemplateComponents {
  Layout: ComponentType<BaseProps & { children: ReactNode }>;
  Home: ComponentType<BaseProps>;
  About: ComponentType<BaseProps>;
  Services: ComponentType<BaseProps>;
  ServiceDetail: ComponentType<BaseProps & { service: PublicService }>;
  Doctors: ComponentType<BaseProps>;
  DoctorDetail: ComponentType<BaseProps & { doctor: PublicDoctor }>;
  Clinic: ComponentType<BaseProps>;
  Testimonials: ComponentType<BaseProps>;
  Faq: ComponentType<BaseProps>;
  Articles: ComponentType<BaseProps & { cards: PublicArticleCard[]; page: number; pageCount: number }>;
  ArticleDetail: ComponentType<BaseProps & { article: PublicArticle }>;
  Contact: ComponentType<BaseProps>;
  Legal: ComponentType<BaseProps & { title: string; text: string }>;
  Appointments: ComponentType<BaseProps & { doctor?: PublicDoctor | null }>;
}

export interface TemplateDefinition { key: string; name: string; description: string; components: TemplateComponents }
