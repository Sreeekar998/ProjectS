import { describe, it, expect } from "vitest";
import { classifyIpv4, classifyIpv6, classifyIp } from "@/lib/security/ip-guard";

describe("classifyIpv4", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.0.0.53", "loopback"],
    ["10.0.0.1", "private-10"],
    ["172.16.5.1", "private-172"],
    ["172.31.255.255", "private-172"],
    ["192.168.1.1", "private-192"],
    ["169.254.169.254", "link-local-and-cloud-metadata"], // AWS/GCP metadata endpoint
    ["169.254.0.1", "link-local-and-cloud-metadata"],
    ["100.64.0.1", "carrier-nat"],
    ["0.0.0.0", "this-network"],
    ["192.0.2.1", "test-net-1"],
    ["198.51.100.1", "test-net-2"],
    ["203.0.113.1", "test-net-3"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"], // within 240.0.0.0/4, matched before the more specific /32 entry — still blocked either way
  ])("blocks %s (%s)", (ip, label) => {
    const result = classifyIpv4(ip);
    expect(result.blocked).toBe(true);
    expect(result.label).toBe(label);
  });

  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.15.255.255", "172.32.0.1"])("allows public address %s", (ip) => {
    expect(classifyIpv4(ip).blocked).toBe(false);
  });

  it("blocks unparseable input rather than allowing it", () => {
    expect(classifyIpv4("not-an-ip").blocked).toBe(true);
    expect(classifyIpv4("999.999.999.999").blocked).toBe(true);
  });
});

describe("classifyIpv6", () => {
  it("blocks loopback ::1", () => {
    expect(classifyIpv6("::1").blocked).toBe(true);
  });
  it("blocks unspecified ::", () => {
    expect(classifyIpv6("::").blocked).toBe(true);
  });
  it("blocks link-local fe80::/10", () => {
    expect(classifyIpv6("fe80::1").blocked).toBe(true);
  });
  it("blocks unique-local fc00::/7", () => {
    expect(classifyIpv6("fd12:3456:789a::1").blocked).toBe(true);
  });
  it("blocks IPv4-mapped private addresses (SSRF bypass attempt)", () => {
    expect(classifyIpv6("::ffff:127.0.0.1").blocked).toBe(true);
    expect(classifyIpv6("::ffff:192.168.1.1").blocked).toBe(true);
  });
  it("allows a public IPv6 address", () => {
    expect(classifyIpv6("2606:4700:4700::1111").blocked).toBe(false); // Cloudflare DNS
  });
});

describe("classifyIp dispatch", () => {
  it("routes by family", () => {
    expect(classifyIp("10.0.0.1", 4).blocked).toBe(true);
    expect(classifyIp("::1", 6).blocked).toBe(true);
    expect(classifyIp("8.8.8.8", 4).blocked).toBe(false);
  });
});
