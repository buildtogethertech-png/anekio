import { useEffect, useState } from "react";
import { webOrigin } from "./api";
import { useSession } from "./session";

export function publicAssetUrl(rel?: string | null) {
  if (!rel) return "";
  if (/^https?:\/\//i.test(rel) || rel.startsWith("data:")) return rel;
  return `${webOrigin()}/api/files/${String(rel).replace(/^\/+/, "")}`;
}

function needsAuthenticatedUrl(rel: string) {
  return rel.startsWith("private/") || rel.startsWith("school/admissions/");
}

export function useAssetUrl(rel?: string | null) {
  const { token } = useSession();
  const value = String(rel || "").replace(/^\/+/, "");
  const immediate = value && !needsAuthenticatedUrl(value) ? publicAssetUrl(value) : "";
  const [url, setUrl] = useState(immediate);

  useEffect(() => {
    let active = true;
    if (!value || !needsAuthenticatedUrl(value)) {
      setUrl(immediate);
      return () => {
        active = false;
      };
    }
    if (!token) {
      setUrl("");
      return () => {
        active = false;
      };
    }
    setUrl("");
    void fetch(`${webOrigin()}/api/files/view-url`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: value }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({})) as { url?: string };
        if (!response.ok || !data.url) throw new Error("Could not load private asset");
        if (active) setUrl(data.url);
      })
      .catch(() => {
        if (active) setUrl("");
      });
    return () => {
      active = false;
    };
  }, [immediate, token, value]);

  return url;
}
