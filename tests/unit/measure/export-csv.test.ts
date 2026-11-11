import { describe, expect, it } from "vitest";
import { csvBody, csvCell } from "@/lib/measure/export";

describe("CSV export cells", () => {
  it("quotes commas, quotes and line breaks of either kind", () => {
    expect(csvCell('Is "X" good, or not?')).toBe('"Is ""X"" good, or not?"');
    expect(csvCell("line one\r\nline two")).toBe('"line one\r\nline two"');
    expect(csvCell(["a", "b"])).toBe("a; b");
    expect(csvCell(null)).toBe("");
  });

  // Question text, brand names and cited domains come from model output and
  // answer pages; a cell starting with "=" runs as a formula in Excel and Sheets.
  it("neutralises cells a spreadsheet would run as a formula", () => {
    expect(csvCell("=HYPERLINK(\"http://x\")")).toBe("\"'=HYPERLINK(\"\"http://x\"\")\"");
    expect(csvCell("+1 800 000")).toBe("'+1 800 000");
    expect(csvCell("-5 things")).toBe("'-5 things");
    expect(csvCell("@user")).toBe("'@user");
    expect(csvCell("plain text")).toBe("plain text");
  });

  it("writes a UTF-8 BOM and CRLF line ends so Excel reads accented names", () => {
    const body = csvBody(["a", "b"], [["1", "Café"]]);
    expect(body.startsWith("﻿")).toBe(true);
    expect(body).toBe("﻿a,b\r\n1,Café\r\n");
  });
});
