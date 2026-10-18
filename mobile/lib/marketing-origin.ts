export function marketingOrigin(appOrigin: string) {
  const url = new URL(appOrigin);
  if (url.hostname.startsWith("app.")) url.hostname = url.hostname.slice(4);
  // Local dev: the app runs on Expo (8081) but the marketing page is served by the API server (4000).
  if (["localhost", "127.0.0.1"].includes(url.hostname) && url.port === "8081") url.port = "4000";
  return url.origin;
}
