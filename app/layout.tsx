import type { Metadata } from "next";
import { Header } from "@/components/Header";
import { APP_NAME, APP_TAGLINE } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: APP_TAGLINE,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-50 antialiased">
        <Header />
        <main className="mx-auto max-w-5xl px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
