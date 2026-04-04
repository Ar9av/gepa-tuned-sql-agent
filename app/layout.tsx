import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SQL Agent — Self-Debugging + GEPA",
  description: "Self-debugging SQL agent with evolutionary prompt optimization",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
