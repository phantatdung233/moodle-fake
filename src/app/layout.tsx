import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter } from "next/font/google";
import "./globals.css";

/**
 * Swiss style uses one grotesque for everything. Inter is the closest
 * variable Google font to Helvetica/Univers, and it carries Vietnamese
 * diacritics in the `latin-ext` + `vietnamese` subsets.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin", "latin-ext", "vietnamese"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Luyện tập Python",
    template: "%s · Luyện tập Python",
  },
  description: "Làm bài trắc nghiệm Python và xem giải thích cho từng câu.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

/**
 * Applies the stored theme before first paint so dark mode never flashes a
 * light frame. Defaults to light; "system" is only used when explicitly chosen.
 */
const themeScript = `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="vi"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
