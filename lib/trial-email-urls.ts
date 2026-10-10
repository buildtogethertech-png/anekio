/** Keep account links on known Anekio hosts; never embed an untrusted Host header in email. */
export function trialEmailOrigins(hostname: string) {
  const host = hostname.toLowerCase().replace(/:\d+$/, "");
  if (host === "localhost" || host === "127.0.0.1" || host === "app.localhost") {
    return { site: "http://localhost:4000", app: "http://localhost:8081" };
  }
  if (host === "staging.anekio.com" || host.endsWith(".staging.anekio.com")) {
    return { site: "https://staging.anekio.com", app: "https://app.staging.anekio.com" };
  }
  return { site: "https://anekio.com", app: "https://app.anekio.com" };
}
