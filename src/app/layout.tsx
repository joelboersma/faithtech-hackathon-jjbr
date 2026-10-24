import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Church dashboard | FaithTech",
  description: "Registered churches, locations, and reported baptisms across the FaithTech church network.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
