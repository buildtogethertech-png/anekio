import { afterEach, describe, expect, it, vi } from "vitest";
import {
  renderSaasEmailTemplate,
  resolveSaasEmailRuntime,
  resolveSaasEmailEnvironment,
  sendResendPlatformEmail,
} from "../../lib/saas-email";

describe("SaaS email helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses production only for the public Anekio hosts", () => {
    expect(resolveSaasEmailEnvironment({ host: "anekio.com" })).toBe("production");
    expect(resolveSaasEmailEnvironment({ host: "www.anekio.com:443" })).toBe("production");
    expect(resolveSaasEmailEnvironment({ host: "staging.anekio.com" })).toBe("staging");
    expect(resolveSaasEmailEnvironment({ host: "localhost:4000" })).toBe("staging");
    expect(resolveSaasEmailEnvironment({ host: "anekio.com", environment: "staging" })).toBe("staging");
  });

  it("uses environment mail credentials even when database delivery is disabled", () => {
    vi.stubEnv("ANEKIO_PLATFORM_RESEND_API_KEY", "re_platform_test");
    vi.stubEnv("ANEKIO_PLATFORM_FROM_EMAIL", "Anekio Team <team@anekio.com>");
    const runtime = resolveSaasEmailRuntime({
      enabled: false,
      resendApiKey: "",
      productionFromName: "Old sender",
      productionFromEmail: "old@example.com",
      stagingFromName: "Old staging",
      stagingFromEmail: "old-staging@example.com",
      stagingSafeRecipients: "[\"support@anekio.com\"]",
    });
    expect(runtime).toMatchObject({
      enabled: true,
      resendApiKey: "re_platform_test",
      productionFromName: "Anekio Team",
      productionFromEmail: "team@anekio.com",
      stagingFromEmail: "team@anekio.com",
      stagingSafeRecipients: "[\"support@anekio.com\"]",
    });
  });

  it("falls back to the existing auth-mail environment settings", () => {
    vi.stubEnv("ANEKIO_PLATFORM_RESEND_API_KEY", "");
    vi.stubEnv("ANEKIO_PLATFORM_FROM_EMAIL", "");
    vi.stubEnv("ANEKIO_AUTH_RESEND_API_KEY", "re_auth_test");
    vi.stubEnv("ANEKIO_AUTH_FROM_EMAIL", "Anekio <support@anekio.com>");
    expect(resolveSaasEmailRuntime({
      enabled: false,
      resendApiKey: "",
      productionFromName: "Database",
      productionFromEmail: "db@example.com",
      stagingFromName: "Database",
      stagingFromEmail: "db@example.com",
    })).toMatchObject({ enabled: true, resendApiKey: "re_auth_test", productionFromEmail: "support@anekio.com" });
  });

  it("escapes values when rendering an HTML template", () => {
    const html = renderSaasEmailTemplate(
      "<p>Hello {{ownerName}}</p><a href=\"{{leadUrl}}\">Open lead</a>",
      {
        ownerName: `Asha & <School> \"Principal\" 'Owner'`,
        leadUrl: "https://anekio.com/anekio-admin?lead=1&source=demo",
      },
      "html"
    );

    expect(html).toBe(
      "<p>Hello Asha &amp; &lt;School&gt; &quot;Principal&quot; &#39;Owner&#39;</p><a href=\"https://anekio.com/anekio-admin?lead=1&amp;source=demo\">Open lead</a>"
    );
  });

  it("sends every configured recipient field to Resend", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_test_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendResendPlatformEmail({
      apiKey: "re_test_not_a_real_key",
      from: "Anekio Support <support@anekio.com>",
      to: ["sales@anekio.com", "support@anekio.com"],
      cc: ["ops@anekio.com"],
      bcc: ["archive@anekio.com"],
      replyTo: ["support@anekio.com"],
      subject: "New demo request",
      text: "A school booked a demo.",
      html: "<p>A school booked a demo.</p>",
    });

    expect(result.messageId).toBe("email_test_123");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer re_test_not_a_real_key",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(request.body))).toEqual({
      from: "Anekio Support <support@anekio.com>",
      to: ["sales@anekio.com", "support@anekio.com"],
      cc: ["ops@anekio.com"],
      bcc: ["archive@anekio.com"],
      reply_to: ["support@anekio.com"],
      subject: "New demo request",
      text: "A school booked a demo.",
      html: "<p>A school booked a demo.</p>",
    });
  });
});
