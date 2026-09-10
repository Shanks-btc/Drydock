import type { Metadata } from "next";
import { Space_Grotesk, Inter } from "next/font/google";
import Nav from "@/components/layout/Nav";
import Footer from "@/components/layout/Footer";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space-grotesk",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Drydock — deploy with memory",
  description:
    "Ship faster. Never ship the same failure twice. One gasless USDC payment ships your static site on Base — but not before Drydock checks the build against every past deployment incident it has seen.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`}>
      <body className="min-h-screen w-full max-w-[100vw] bg-canvas font-body text-ink-body antialiased">
        <Nav />
        {children}
        <Footer />
      </body>
    </html>
  );
}
