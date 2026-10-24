import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FaithTech starter",
  description: "Next.js, Supabase, Prisma, MCP, Zod, and Sinch starter",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
