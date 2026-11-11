// Pure IP-range classification used by the SSRF guard. No network calls
// here on purpose, so it stays trivially unit-testable.

function ipv4ToOctets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) return null;
  return octets;
}

function ipv4ToInt(octets: number[]): number {
  return (((octets[0]! << 24) | (octets[1]! << 16) | (octets[2]! << 8) | octets[3]!) >>> 0);
}

const IPV4_BLOCKED_RANGES: Array<{ base: number[]; maskBits: number; label: string }> = [
  { base: [0, 0, 0, 0], maskBits: 8, label: "this-network" },
  { base: [10, 0, 0, 0], maskBits: 8, label: "private-10" },
  { base: [100, 64, 0, 0], maskBits: 10, label: "carrier-nat" },
  { base: [127, 0, 0, 0], maskBits: 8, label: "loopback" },
  { base: [169, 254, 0, 0], maskBits: 16, label: "link-local-and-cloud-metadata" },
  { base: [172, 16, 0, 0], maskBits: 12, label: "private-172" },
  { base: [192, 0, 0, 0], maskBits: 24, label: "ietf-protocol-assignments" },
  { base: [192, 0, 2, 0], maskBits: 24, label: "test-net-1" },
  { base: [192, 168, 0, 0], maskBits: 16, label: "private-192" },
  { base: [198, 18, 0, 0], maskBits: 15, label: "benchmark" },
  { base: [198, 51, 100, 0], maskBits: 24, label: "test-net-2" },
  { base: [203, 0, 113, 0], maskBits: 24, label: "test-net-3" },
  { base: [224, 0, 0, 0], maskBits: 4, label: "multicast" },
  { base: [240, 0, 0, 0], maskBits: 4, label: "reserved" },
  { base: [255, 255, 255, 255], maskBits: 32, label: "broadcast" },
];

function isIpv4InRange(octets: number[], range: { base: number[]; maskBits: number }): boolean {
  const ipInt = ipv4ToInt(octets);
  const baseInt = ipv4ToInt(range.base);
  const mask = range.maskBits === 0 ? 0 : (0xffffffff << (32 - range.maskBits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function classifyIpv4(ip: string): { blocked: boolean; label?: string } {
  const octets = ipv4ToOctets(ip);
  if (!octets) return { blocked: true, label: "unparseable" };
  for (const range of IPV4_BLOCKED_RANGES) {
    if (isIpv4InRange(octets, range)) return { blocked: true, label: range.label };
  }
  return { blocked: false };
}

function ipv6ToBigInt(ip: string): bigint | null {
  let full = ip;
  // IPv4-mapped / IPv4-compatible textual form, e.g. ::ffff:192.168.1.1
  const v4Match = /^([0-9a-fA-F:]*:)([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3})$/.exec(full);
  if (v4Match) {
    const octets = ipv4ToOctets(v4Match[2]!);
    if (!octets) return null;
    const hex = octets.map((o) => o.toString(16).padStart(2, "0")).join("");
    full = `${v4Match[1]}${hex.slice(0, 4)}:${hex.slice(4)}`;
  }
  if (!full.includes("::") && full.split(":").length !== 8) return null;
  let head = full;
  let tail = "";
  if (full.includes("::")) {
    const [h, t] = full.split("::");
    head = h ?? "";
    tail = t ?? "";
  }
  const headParts = head ? head.split(":").filter(Boolean) : [];
  const tailParts = tail ? tail.split(":").filter(Boolean) : [];
  const missing = 8 - headParts.length - tailParts.length;
  if (missing < 0) return null;
  const allParts = [...headParts, ...Array(missing).fill("0"), ...tailParts];
  if (allParts.length !== 8) return null;
  let result = 0n;
  for (const part of allParts) {
    const val = parseInt(part, 16);
    if (Number.isNaN(val) || val < 0 || val > 0xffff) return null;
    result = (result << 16n) | BigInt(val);
  }
  return result;
}

function ipv4EmbeddedInV6(big: bigint): number[] {
  // Extract the low 32 bits — used for ::ffff:a.b.c.d and 64:ff9b::a.b.c.d style checks.
  const low32 = Number(big & 0xffffffffn);
  return [
    (low32 >>> 24) & 0xff,
    (low32 >>> 16) & 0xff,
    (low32 >>> 8) & 0xff,
    low32 & 0xff,
  ];
}

const IPV6_BLOCKED_RANGES: Array<{ base: bigint; maskBits: number; label: string }> = [
  { base: 0n, maskBits: 128, label: "unspecified" },
  { base: 1n, maskBits: 128, label: "loopback" },
  { base: 0xfe80n << 112n, maskBits: 10, label: "link-local" },
  { base: 0xfc00n << 112n, maskBits: 7, label: "unique-local" },
  { base: 0x2001n << 112n | (0x0db8n << 96n), maskBits: 32, label: "documentation" },
];

export function classifyIpv6(ip: string): { blocked: boolean; label?: string } {
  const big = ipv6ToBigInt(ip);
  if (big === null) return { blocked: true, label: "unparseable" };
  for (const range of IPV6_BLOCKED_RANGES) {
    const shift = 128 - range.maskBits;
    const mask = shift >= 128 ? 0n : (((1n << BigInt(range.maskBits)) - 1n) << BigInt(shift));
    if ((big & mask) === (range.base & mask)) return { blocked: true, label: range.label };
  }
  // IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96): re-check embedded IPv4.
  const mappedMask = ~0xffffffffn;
  const ffffPrefix = 0xffffn << 32n;
  if ((big & mappedMask) === ffffPrefix) {
    const embedded = ipv4EmbeddedInV6(big);
    const v4 = classifyIpv4(embedded.join("."));
    if (v4.blocked) return { blocked: true, label: `ipv4-mapped:${v4.label}` };
  }
  return { blocked: false };
}

export function classifyIp(ip: string, family: 4 | 6): { blocked: boolean; label?: string } {
  return family === 4 ? classifyIpv4(ip) : classifyIpv6(ip);
}
