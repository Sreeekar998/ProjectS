import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Project Sun — AI Visibility Measurement",
  description: "Measure how your brand appears when buyers ask AI — from buyer prompts to observable evidence.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
