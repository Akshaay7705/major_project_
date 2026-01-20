import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Live Avatar Demo",
  description: "HeyGen Live Avatar Interactive Demo",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className="bg-zinc-900 flex flex-col min-h-screen text-white justify-center items-center"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
