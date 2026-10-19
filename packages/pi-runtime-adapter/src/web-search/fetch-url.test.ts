import { describe, expect, it } from "vitest";
import { checkWebFetchUrl } from "./fetch-url";

const MAX = 8192;
const accepted = (raw: string) => {
  const checked = checkWebFetchUrl(raw, MAX);
  if (!checked.ok) throw new Error(`refused: ${checked.message}`);
  return checked.url;
};
const refusal = (raw: string, max = MAX) => {
  const checked = checkWebFetchUrl(raw, max);
  if (checked.ok) throw new Error(`accepted: ${checked.url}`);
  return checked.message;
};

describe("checkWebFetchUrl", () => {
  it("accepts public http and https addresses and normalizes them", () => {
    expect(accepted("  https://Example.TEST/a/b?q=1#part  ")).toBe(
      "https://example.test/a/b?q=1"
    );
    expect(accepted("http://docs.example.test:8080/x")).toBe(
      "http://docs.example.test:8080/x"
    );
    expect(accepted("https://203.0.114.1/")).toBe("https://203.0.114.1/");
    expect(accepted("https://[2a0f:1234::1]/")).toBe("https://[2a0f:1234::1]/");
  });

  it("keeps the same page under one address whatever its fragment", () => {
    expect(accepted("https://example.test/a#one")).toBe(
      accepted("https://example.test/a#two")
    );
  });

  it("refuses empty, over-long and unparsable input", () => {
    expect(refusal("   ")).toContain("不能为空");
    expect(refusal("https://example.test/" + "a".repeat(40), 30)).toContain(
      "超过 30 个字符"
    );
    expect(refusal("example.test/page")).toContain("不是有效的网页地址");
    expect(refusal("not a url")).toContain("不是有效的网页地址");
  });

  it.each([
    "file:///etc/hosts",
    "ftp://example.test/file",
    "javascript:alert(1)",
    "data:text/html,hello",
    "mailto:a@example.test"
  ])("refuses %s because it is not http(s)", (raw) => {
    expect(refusal(raw)).toContain("http 或 https");
  });

  it("refuses an address that carries a user name or password", () => {
    expect(refusal("https://user@example.test/")).toContain("用户名或密码");
    expect(refusal("https://user:pass@example.test/")).toContain(
      "用户名或密码"
    );
  });

  it.each([
    "http://localhost/",
    "http://LOCALHOST:3000/",
    "http://app.localhost/",
    "http://printer.local/",
    "http://nas/",
    "http://intranet/wiki",
    "http://git.corp/",
    "http://db.internal/",
    "http://router.home.arpa/",
    "http://example.test./".replace("example.test", "box.lan"),
    "http://localhost./",
    "http://127.0.0.1./",
    "http://0177.0.0.1/",
    "http://１２７.０.０.１/",
    "http://[::ffff:7f00:1]/",
    "http://127.0.0.1/",
    "http://127.1/",
    "http://0x7f.0.0.1/",
    "http://2130706433/",
    "http://0.0.0.0/",
    "http://10.1.2.3/",
    "http://172.16.0.1/",
    "http://172.31.255.255/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://100.64.0.1/",
    "http://224.0.0.1/",
    "http://255.255.255.255/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[ff02::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:c0a8:0101]/",
    "http://[64:ff9b::7f00:1]/"
  ])("refuses the local or private address %s", (raw) => {
    expect(refusal(raw)).toContain("内网或本机");
  });

  it("does not mistake neighbouring public ranges for private ones", () => {
    expect(accepted("http://172.15.0.1/")).toBe("http://172.15.0.1/");
    expect(accepted("http://172.32.0.1/")).toBe("http://172.32.0.1/");
    expect(accepted("http://100.63.255.255/")).toBe("http://100.63.255.255/");
    expect(accepted("http://192.169.0.1/")).toBe("http://192.169.0.1/");
  });
});
