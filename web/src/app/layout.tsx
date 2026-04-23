import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "생활기록부 생성 도우미",
  description: "학생별 자율활동 및 진로활동 입력 도우미",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <head>
        <link rel="stylesheet" as="style" crossOrigin="anonymous" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.8/dist/web/static/pretendard.css" />
      </head>
      <body className="h-full overflow-hidden flex flex-col font-['Pretendard',_sans-serif]">
        {children}
      </body>
    </html>
  );
}
