import type { Metadata, Viewport } from "next";
import { Caveat, Fraunces } from "next/font/google";
import "./globals.css";

const hand = Caveat({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-hand",
  display: "swap",
});

const serif = Fraunces({
  subsets: ["latin"],
  weight: ["400", "600"],
  variable: "--font-serif",
  display: "swap",
});

export const metadata: Metadata = {
  title: "La Sigaretta",
  description:
    "Il gioco della sigaretta: otto domande, un foglietto che gira, e alla fine si leggono le storie assurde che ne escono.",
};

export const viewport: Viewport = {
  themeColor: "#f4efe4",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="it" className={`${hand.variable} ${serif.variable}`}>
      <body>
        <div className="shell">{children}</div>
      </body>
    </html>
  );
}
