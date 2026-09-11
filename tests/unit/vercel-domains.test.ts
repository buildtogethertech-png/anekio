import { describe, expect, it, vi } from "vitest";
import { ensureVercelSchoolWebsiteDomain, resolveVercelDomainConfig } from "../../lib/vercel-domains";

function response(status: number, body: unknown = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn(async () => body),
    text: vi.fn(async () => JSON.stringify(body)),
  } as unknown as Response;
}

describe("vercel domain registration", () => {
  it("skips registration when Vercel credentials are not configured", async () => {
    const fetchMock = vi.fn();

    const result = await ensureVercelSchoolWebsiteDomain("greenvalley2", {
      origin: "https://app.staging.anekio.com",
      env: {},
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({
      status: "skipped",
      hostname: "greenvalley2.staging.anekio.com",
      reason: "not_configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses explicit Anekio env vars before generic Vercel env vars", () => {
    const config = resolveVercelDomainConfig({
      ANEKIO_VERCEL_TOKEN: "token",
      ANEKIO_VERCEL_PROJECT_ID: "project",
      ANEKIO_VERCEL_TEAM_ID: "team",
      ANEKIO_VERCEL_DEPLOYMENT_URL: "https://deployment.vercel.app/path",
    });

    expect(config).toMatchObject({
      token: "token",
      projectIdOrName: "project",
      teamId: "team",
      deploymentIdOrUrl: "deployment.vercel.app",
    });
  });

  it("registers a missing project domain and assigns the current deployment alias", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(404, { error: { code: "not_found", message: "not found" } }))
      .mockResolvedValueOnce(response(200, [{ domain: "greenvalley2.staging.anekio.com" }]))
      .mockResolvedValueOnce(response(200, { alias: "greenvalley2.staging.anekio.com" }));

    const result = await ensureVercelSchoolWebsiteDomain("greenvalley2", {
      origin: "https://app.staging.anekio.com",
      env: {
        ANEKIO_VERCEL_TOKEN: "token",
        ANEKIO_VERCEL_PROJECT_ID: "prj_123",
        ANEKIO_VERCEL_TEAM_ID: "team_123",
        VERCEL_URL: "anekio-staging.example.vercel.app",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result).toEqual({ status: "ready", hostname: "greenvalley2.staging.anekio.com" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.vercel.com/v9/projects/prj_123/domains/greenvalley2.staging.anekio.com?teamId=team_123",
      expect.objectContaining({ method: "GET" })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://api.vercel.com/projects/prj_123/alias?teamId=team_123",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ target: "PRODUCTION", domain: "greenvalley2.staging.anekio.com" }),
      })
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.vercel.com/now/deployments/anekio-staging.example.vercel.app/aliases?teamId=team_123",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ alias: "greenvalley2.staging.anekio.com" }),
      })
    );
  });

  it("issues an exact certificate when alias creation reports one is missing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(response(200, { name: "greenvalley2.staging.anekio.com" }))
      .mockResolvedValueOnce(response(400, { error: { code: "cert_missing", message: "Certificate missing" } }))
      .mockResolvedValueOnce(response(200, { uid: "cert_123" }))
      .mockResolvedValueOnce(response(200, { alias: "greenvalley2.staging.anekio.com" }));

    const result = await ensureVercelSchoolWebsiteDomain("greenvalley2", {
      origin: "https://app.staging.anekio.com",
      env: {
        ANEKIO_VERCEL_TOKEN: "token",
        ANEKIO_VERCEL_PROJECT_ID: "prj_123",
        ANEKIO_VERCEL_TEAM_ID: "team_123",
        VERCEL_URL: "anekio-staging.example.vercel.app",
      },
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    expect(result.status).toBe("ready");
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.vercel.com/v3/certs?teamId=team_123",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ domains: ["greenvalley2.staging.anekio.com"] }),
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
