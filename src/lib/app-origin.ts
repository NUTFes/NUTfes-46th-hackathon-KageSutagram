// QRリンクにはパス・認証情報・クエリを含まない安全なオリジンのみ使う。
export function parseAppOrigin(value: string): string {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost")) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Invalid app origin");
  }
  return url.origin;
}

export function qrBaseUrl(
  configured: string | undefined,
  requestOrigin: string,
) {
  try {
    return parseAppOrigin(configured ?? "");
  } catch {
    return requestOrigin;
  }
}
