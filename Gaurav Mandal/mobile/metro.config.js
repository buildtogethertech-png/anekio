const http = require("http");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = withNativeWind(getDefaultConfig(__dirname), { input: "./global.css" });
const apiProxyPort = Number(process.env.ANEKIO_API_PROXY_PORT || 4000);
const serverRenderedRoutes = [
  "/anekio-admin",
  "/anekio/enquiry",
  "/features",
  "/pricing",
  "/robots.txt",
  "/sitemap.xml",
];

function proxyToApi(req, res) {
  const headers = { ...req.headers, host: `127.0.0.1:${apiProxyPort}` };
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: apiProxyPort,
      path: req.url,
      method: req.method,
      headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );
  upstream.on("error", () => {
    res.statusCode = 502;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "API is off. Keep npm run api running." }));
  });
  req.pipe(upstream);
}

const previous = config.server?.enhanceMiddleware;
config.server = {
  ...config.server,
  enhanceMiddleware: (middleware, server) => {
    const metro = previous ? previous(middleware, server) : middleware;
    return (req, res, next) => {
      if (
        req.url &&
        (req.url.startsWith("/api/") ||
          req.url.startsWith("/pay/") ||
          req.url.startsWith("/i/") ||
          serverRenderedRoutes.some((route) => req.url === route || req.url.startsWith(`${route}?`)))
      ) {
        proxyToApi(req, res);
        return;
      }
      return metro(req, res, next);
    };
  },
};

module.exports = config;
