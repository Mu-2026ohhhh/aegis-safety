import type { ReactNode } from "react";
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/geist-mono/500.css";
import "./globals.css";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      data-scroll-behavior="smooth"
      className="dark h-full antialiased"
    >
      <body className="flex min-h-full flex-col bg-slate-950 font-sans text-slate-100">
        {children}
      </body>
    </html>
  );
}
