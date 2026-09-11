import { schoolWebsiteHostname } from "./host-routing";
import { publicOrigin } from "./utils";

type Fetcher = typeof fetch;

type VercelDomainConfig = {
  token: string;
  projectIdOrName: string;
  teamId?: string;
  deploymentIdOrUrl?: string;
  fetchImpl: Fetcher;
};

export type VercelDomainResult =
  | { status: "ready"; hostname: string }
  | { status: "skipped"; hostname: string; reason: "not_configured" | "disabled" }
  | { status: "failed"; hostname: string; reason: string };

class VercelApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | undefined,
    message: string
  ) {
    super(message);
  }
}

function envValue(env: NodeJS.ProcessEnv, ...keys: string[]) {
  for (const key of keys) {
    const value = String(env[key] || "").trim();
    if (value) return value;
  }
  return "";
}

function cleanDeployment(value: string) {
  return value.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").trim();
}

export function resolveVercelDomainConfig(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: Fetcher = fetch
): VercelDomainConfig | null {
  if (env.ANEKIO_VERCEL_AUTO_DOMAINS === "0") return null;

  const token = envValue(env, "ANEKIO_VERCEL_TOKEN", "VERCEL_TOKEN");
  const projectIdOrName = envValue(env, "ANEKIO_VERCEL_PROJECT_ID", "ANEKIO_VERCEL_PROJECT", "VERCEL_PROJECT_ID");
  if (!token || !projectIdOrName) return null;

  const teamId = envValue(env, "ANEKIO_VERCEL_TEAM_ID", "VERCEL_TEAM_ID", "VERCEL_ORG_ID");
  const deploymentIdOrUrl = cleanDeployment(envValue(env, "ANEKIO_VERCEL_DEPLOYMENT", "ANEKIO_VERCEL_DEPLOYMENT_URL", "VERCEL_URL"));
  return {
    token,
    projectIdOrName,
    teamId: teamId || undefined,
    deploymentIdOrUrl: deploymentIdOrUrl || undefined,
    fetchImpl,
  };
}

function apiUrl(config: VercelDomainConfig, pathname: string) {
  const url = new URL(pathname, "https://api.vercel.com");
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  return url.toString();
}

function errorInfo(payload: unknown) {
  const body = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
  const nested = body.error && typeof body.error === "object" ? (body.error as Record<string, unknown>) : body;
  const code = typeof nested.code === "string" ? nested.code : undefined;
  const message = typeof nested.message === "string" ? nested.message : code || "Vercel API request failed.";
  return { code, message };
}

async function vercelFetch(config: VercelDomainConfig, pathname: string, init: { method?: string; body?: unknown } = {}) {
  const response = await config.fetchImpl(apiUrl(config, pathname), {
    method: init.method || "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const payload = await response.json().catch(async () => {
    const text = await response.text().catch(() => "");
    return text ? { message: text } : {};
  });

  if (!response.ok) {
    const { code, message } = errorInfo(payload);
    throw new VercelApiError(response.status, code, message);
  }
  return payload;
}

async function projectDomainExists(config: VercelDomainConfig, hostname: string) {
  try {
    await vercelFetch(
      config,
      `/v9/projects/${encodeURIComponent(config.projectIdOrName)}/domains/${encodeURIComponent(hostname)}`
    );
    return true;
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 404) return false;
    throw error;
  }
}

async function addProjectDomain(config: VercelDomainConfig, hostname: string) {
  await vercelFetch(config, `/projects/${encodeURIComponent(config.projectIdOrName)}/alias`, {
    method: "POST",
    body: { target: "PRODUCTION", domain: hostname },
  });
}

async function issueCertificate(config: VercelDomainConfig, hostname: string) {
  await vercelFetch(config, "/v3/certs", {
    method: "POST",
    body: { domains: [hostname] },
  });
}

async function assignDeploymentAlias(config: VercelDomainConfig, hostname: string) {
  if (!config.deploymentIdOrUrl) return;
  const endpoint = `/now/deployments/${encodeURIComponent(config.deploymentIdOrUrl)}/aliases`;
  try {
    await vercelFetch(config, endpoint, { method: "POST", body: { alias: hostname } });
  } catch (error) {
    if (error instanceof VercelApiError && error.status === 409) return;
    if (error instanceof VercelApiError && (error.code === "cert_missing" || error.code === "cert_expired")) {
      await issueCertificate(config, hostname);
      try {
        await vercelFetch(config, endpoint, { method: "POST", body: { alias: hostname } });
      } catch (retryError) {
        if (retryError instanceof VercelApiError && retryError.status === 409) return;
        throw retryError;
      }
      return;
    }
    throw error;
  }
}

export async function ensureVercelSchoolWebsiteDomain(
  slug: string,
  opts: {
    enabled?: boolean;
    origin?: string;
    env?: NodeJS.ProcessEnv;
    fetchImpl?: Fetcher;
    logger?: Pick<Console, "warn">;
  } = {}
): Promise<VercelDomainResult> {
  const hostname = schoolWebsiteHostname(slug, opts.origin || publicOrigin());
  if (opts.enabled === false) return { status: "skipped", hostname, reason: "disabled" };

  const config = resolveVercelDomainConfig(opts.env || process.env, opts.fetchImpl || fetch);
  if (!config) return { status: "skipped", hostname, reason: "not_configured" };

  try {
    if (!(await projectDomainExists(config, hostname))) {
      await addProjectDomain(config, hostname);
    }
    await assignDeploymentAlias(config, hostname);
    return { status: "ready", hostname };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Vercel domain registration failed.";
    opts.logger?.warn(`[vercel-domains] Could not register ${hostname}: ${reason}`);
    return { status: "failed", hostname, reason };
  }
}
