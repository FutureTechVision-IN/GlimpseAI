import { describe, expect, test } from "vitest";
import { buildMediaReferenceCode, parseMediaReferenceCode } from "./media-reference";

describe("media-reference", () => {
  test("parseMediaReferenceCode round-trip shape", () => {
    const code = buildMediaReferenceCode({
      jobId: 42,
      enhancementType: "portrait",
      completedAt: new Date("2026-04-28T12:00:00.000Z"),
      suffix: "a1b2c3",
    });
    expect(code).toMatch(/^GLP-42-portrait-20260428-a1b2c3$/);
    const parsed = parseMediaReferenceCode(code);
    expect(parsed).toEqual({
      jobId: 42,
      enhancementType: "portrait",
      dateYmd: "20260428",
      suffix: "a1b2c3",
    });
  });

  test("parseMediaReferenceCode rejects garbage", () => {
    expect(parseMediaReferenceCode("not-a-code")).toBeNull();
  });
});
