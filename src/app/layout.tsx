import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "陰スタグラム",
  description: "キラキラは、ぜんぶ陰にする。技大祭の映えないSNS。",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
