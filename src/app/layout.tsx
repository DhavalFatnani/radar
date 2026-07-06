import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/auth.css";
import "./styles/v2.css";
import "./styles/command.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata = {
  title: "Radar",
  description: "Lead-intelligence & matchmaking platform",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="slate" data-mode="light" className={`${inter.variable} ${jetbrains.variable}`}>
      <body>{children}</body>
    </html>
  );
}
