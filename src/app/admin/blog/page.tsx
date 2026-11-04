import type { Metadata } from "next";
import { BlogAdmin } from "@/components/admin/blog-admin";

export const metadata: Metadata = { title: "Blog" };

export default function AdminBlogPage() {
  return <BlogAdmin />;
}
