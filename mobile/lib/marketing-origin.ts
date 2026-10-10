export function marketingOrigin(appOrigin: string) {
  const url = new URL(appOrigin);
  if (url.hostname.startsWith("app.")) url.hostname = url.hostname.slice(4);
  return url.origin;
}
