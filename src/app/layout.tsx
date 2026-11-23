import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DemoStoreProvider } from "@/lib/store";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Capstone Defense Panel Dashboard",
  description: "Rubric-based grading, blind score aggregation, revision tracking and defense minutes.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <DemoStoreProvider>{children}</DemoStoreProvider>
      </body>
    </html>
  );
}
