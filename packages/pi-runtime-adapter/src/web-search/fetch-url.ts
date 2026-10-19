import { BlockList, isIP } from "node:net";

/** Ranges no public page lives in: this machine, private networks and reserved space. */
const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
] as const)
  NON_PUBLIC.addSubnet(network, prefix, "ipv4");
// IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are checked against the IPv4
// ranges above by BlockList itself; a rule for the mapped block would also
// swallow every plain IPv4 address.
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8]
] as const)
  NON_PUBLIC.addSubnet(network, prefix, "ipv6");

/** Names that only resolve inside a private network. */
const PRIVATE_SUFFIXES = [
  "localhost",
  "local",
  "localdomain",
  "internal",
  "lan",
  "intranet",
  "corp",
  "home",
  "home.arpa",
  "private"
];

export type WebFetchUrlCheck =
  { ok: true; url: string } | { ok: false; message: string };

function isNonPublicHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/gu, "").replace(/\.$/u, "");
  const family = isIP(host);
  if (family) return NON_PUBLIC.check(host, family === 4 ? "ipv4" : "ipv6");
  // A public name always has a dot; "intranet" or "nas" is a local one.
  return (
    !host.includes(".") ||
    PRIVATE_SUFFIXES.some((suffix) => host.endsWith(`.${suffix}`))
  );
}

/**
 * What `web_fetch` may be asked to read: a public http(s) page. WHATWG parsing
 * already turns forms like `0x7f.1` or `2130706433` into dotted decimals, so
 * the range check sees the real address. The service fetches on its side, so
 * there is no local network to protect, but a private address in a request
 * would still hand an internal name to a third party. The fragment is dropped
 * because it never changes what the server returns.
 */
export function checkWebFetchUrl(
  raw: string,
  maxChars: number
): WebFetchUrlCheck {
  const text = raw.trim();
  if (!text) return { ok: false, message: "网页地址不能为空。" };
  if (text.length > maxChars)
    return { ok: false, message: `网页地址超过 ${maxChars} 个字符。` };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return {
      ok: false,
      message: "不是有效的网页地址，需要完整的 http 或 https 地址。"
    };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    return { ok: false, message: "只能读取 http 或 https 网页地址。" };
  if (url.username || url.password)
    return { ok: false, message: "网页地址不能带用户名或密码。" };
  if (isNonPublicHost(url.hostname))
    return { ok: false, message: "不能读取内网或本机地址，只能读取公开网页。" };
  url.hash = "";
  return { ok: true, url: url.href };
}
