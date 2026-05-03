import { describe, expect, test } from "vitest";
import { checkTierAccess } from "./tier-config";

describe("tier-config", () => {
  test("hybrid is premium-only", () => {
    expect(checkTierAccess("free", "hybrid")).not.toBeNull();
    expect(checkTierAccess("basic", "hybrid")).not.toBeNull();
    expect(checkTierAccess("premium", "hybrid")).toBeNull();
  });

  test("auto_face is allowed on free and basic (credit limits apply separately)", () => {
    expect(checkTierAccess("free", "auto_face")).toBeNull();
    expect(checkTierAccess("basic", "auto_face")).toBeNull();
    expect(checkTierAccess("premium", "auto_face")).toBeNull();
  });
});
