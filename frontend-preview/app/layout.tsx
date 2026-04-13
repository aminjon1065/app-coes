import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CoESCD — National Disaster Management Platform",
  description: "Command-center for emergency response operators",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-coescd-bg text-coescd-text antialiased">
        {children}
      </body>
    </html>
  );
}
