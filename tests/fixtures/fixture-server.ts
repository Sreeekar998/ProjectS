import http from "node:http";
import type { AddressInfo } from "node:net";

// A tiny local HTTP server that stands in for "a website the crawler has
// never seen" in tests, so the crawler/profile/SSRF test suite never
// depends on live internet access. Serves a small, realistic B2B SaaS-style
// site plus a robots-blocked variant and a JS-only (empty static HTML) page.
const PAGES: Record<string, { status: number; contentType?: string; body: string; headers?: Record<string, string> }> = {
  "/": {
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html lang="en"><head>
      <title>Nimbus Flow - Workflow Automation for Small Teams</title>
      <meta name="description" content="Nimbus Flow helps small teams automate repetitive work without code.">
      <link rel="canonical" href="http://FIXTURE_ORIGIN/">
      <script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Nimbus Flow","alternateName":"NimbusFlow","address":{"@type":"PostalAddress","addressCountry":"United States","addressLocality":"Austin"}}</script>
      </head><body>
      <nav><a href="/about">About</a><a href="/pricing">Pricing</a><a href="/solutions">Solutions</a><a href="/contact">Contact</a><a href="/privacy">Privacy</a></nav>
      <h1>Automate your team's busywork</h1>
      <h2>How to reduce manual data entry</h2>
      <p>Nimbus Flow is workflow automation software for small teams who want to stop copying data between tools by hand.</p>
      <h2>What is Nimbus Flow?</h2>
      <p>It connects your existing apps and automates repetitive tasks, for a small business owner or an operations manager.</p>
      </body></html>`,
  },
  "/about": {
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><title>About - Nimbus Flow</title></head><body>
      <nav><a href="/">Home</a><a href="/pricing">Pricing</a></nav>
      <h1>About Nimbus Flow</h1><p>Founded in Austin, Texas. We serve small businesses across the United States and Canada.</p>
      </body></html>`,
  },
  "/pricing": {
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Pricing - Nimbus Flow</title></head><body>
      <nav><a href="/">Home</a></nav>
      <h1>Simple pricing</h1><h2>Starter plan</h2><h2>Team plan</h2><h2>Enterprise plan</h2>
      <p>Free trial available, no credit card required. Cancel anytime with our money-back guarantee.</p>
      </body></html>`,
  },
  "/solutions": {
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Solutions - Nimbus Flow</title></head><body>
      <h1>Solutions</h1><h2>Workflow automation</h2><h2>Data sync</h2><h2>Approval routing</h2>
      <p>Built for operations managers and small business owners who need reliable automation.</p>
      </body></html>`,
  },
  "/contact": {
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Contact - Nimbus Flow</title></head><body>
      <h1>Contact us</h1><p>123 Congress Ave, Austin, TX. Call +1 512 555 0100.</p>
      </body></html>`,
  },
  "/privacy": {
    status: 200,
    contentType: "text/html",
    body: `<!doctype html><html><head><title>Privacy Policy</title></head><body><h1>Privacy Policy</h1><p>Legal text.</p></body></html>`,
  },
  "/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nAllow: /\nSitemap: http://FIXTURE_ORIGIN/sitemap.xml\n" },
  "/sitemap.xml": {
    status: 200,
    contentType: "application/xml",
    body: `<?xml version="1.0"?><urlset><url><loc>http://FIXTURE_ORIGIN/</loc></url><url><loc>http://FIXTURE_ORIGIN/about</loc></url><url><loc>http://FIXTURE_ORIGIN/pricing</loc></url></urlset>`,
  },
};

const BLOCKED_PAGES: Record<string, { status: number; contentType?: string; body: string }> = {
  "/": { status: 200, contentType: "text/html", body: `<html><head><title>Blocked Co</title></head><body><h1>Blocked Co</h1></body></html>` },
  "/robots.txt": { status: 200, contentType: "text/plain", body: "User-agent: *\nDisallow: /\n" },
};

const JS_HEAVY_PAGES: Record<string, { status: number; contentType?: string; body: string }> = {
  "/": {
    status: 200,
    contentType: "text/html",
    // No headings, minimal text — should trip essentialContentMissing() and
    // attempt the Playwright fallback (which itself gracefully no-ops in
    // CI where Chromium isn't installed).
    body: `<!doctype html><html><head><title>JS App</title></head><body><div id="root"></div></body></html>`,
  },
  "/robots.txt": { status: 404, body: "" },
};

export interface FixtureServer {
  origin: string;
  close: () => Promise<void>;
}

function startServer(pageSet: Record<string, { status: number; contentType?: string; body: string }>): Promise<FixtureServer> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const page = pageSet[url.pathname];
      if (!page) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("not found");
        return;
      }
      res.writeHead(page.status, { "content-type": page.contentType ?? "text/html" });
      res.end(page.body.replaceAll("FIXTURE_ORIGIN", req.headers.host ?? "localhost"));
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      const origin = `http://127.0.0.1:${port}`;
      resolve({ origin, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export const startNormalFixtureSite = () => startServer(PAGES);
export const startBlockedFixtureSite = () => startServer(BLOCKED_PAGES);
export const startJsHeavyFixtureSite = () => startServer(JS_HEAVY_PAGES);
