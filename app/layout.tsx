import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LF/USDT Order Book · Gate.io",
  description: "Live LF/USDT spot order-book data from Gate.io.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
