import App from "@/app/ui";
import { Suspense } from "react";
export function generateStaticParams() {
  return [{ path: [] }];
}
export default function Page() {
  return (
    <Suspense fallback={<p>読み込み中…</p>}>
      <App />
    </Suspense>
  );
}
