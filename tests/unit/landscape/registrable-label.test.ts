import { describe, expect, it } from "vitest";
import { registrableLabel } from "@/lib/landscape/open-knowledge";

describe("registrable label of a host", () => {
  it("reads the business name across country and compound domains", () => {
    expect(registrableLabel("nike.in")).toBe("nike");
    expect(registrableLabel("www.nike.com")).toBe("nike");
    expect(registrableLabel("zara.co.uk")).toBe("zara");
    expect(registrableLabel("shop.nike.com.br")).toBe("nike");
    expect(registrableLabel("app.peec.ai")).toBe("peec");
  });
});
