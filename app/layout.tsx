import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Board",
  description: "A visual moodboard for collecting inspiration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const isDev = process.env.NODE_ENV === "development";

  return (
    <html lang="en" className="dark">
      <head>
        {isDev ? (
          <script
            src="https://mcp.figma.com/mcp/html-to-design/capture.js"
            async
          />
        ) : null}
      </head>
      <body className="bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
