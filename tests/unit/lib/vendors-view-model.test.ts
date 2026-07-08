import { describe, it, expect } from "vitest";
import {
  classifyVendorReadiness,
  readinessLabel,
  readinessPillClass,
  capabilitiesPreview,
  lastChange,
  relativeTime,
  typeHint,
  toComboboxOptions,
} from "@/lib/vendors/view-model";
import type { VendorTypeOption } from "@/lib/vendors/schema";

describe("classifyVendorReadiness", () => {
  it("no type → no_type", () => {
    expect(classifyVendorReadiness({ vendorType: null, mappingCount: 3 })).toBe("no_type");
    expect(classifyVendorReadiness({ vendorType: "  ", mappingCount: 3 })).toBe("no_type");
  });
  it("type with a serving mapping → runnable", () => {
    expect(classifyVendorReadiness({ vendorType: "Infra", mappingCount: 1 })).toBe("runnable");
  });
  it("type but no serving mapping → needs_mapping", () => {
    expect(classifyVendorReadiness({ vendorType: "Ops", mappingCount: 0 })).toBe("needs_mapping");
  });
});

describe("readiness labels + pill classes", () => {
  it("maps each class to a label", () => {
    expect(readinessLabel("runnable")).toBe("Runnable");
    expect(readinessLabel("needs_mapping")).toBe("Needs mapping");
    expect(readinessLabel("no_type")).toBe("No type");
  });
  it("maps each class to a pill class", () => {
    expect(readinessPillClass("runnable")).toBe("pill-runnable");
    expect(readinessPillClass("needs_mapping")).toBe("pill-needs");
    expect(readinessPillClass("no_type")).toBe("pill-notype");
  });
});

describe("capabilitiesPreview", () => {
  it("joins up to max capabilities and appends a +N overflow", () => {
    expect(capabilitiesPreview(["racking", "cctv", "wms", "mhe"], 2)).toBe("racking, cctv +2");
  });
  it("no overflow when within max", () => {
    expect(capabilitiesPreview(["racking", "cctv"], 3)).toBe("racking, cctv");
  });
  it("empty → em dash", () => {
    expect(capabilitiesPreview([], 3)).toBe("—");
  });
});

describe("lastChange", () => {
  it("returns the newest entry's at", () => {
    expect(
      lastChange([
        { at: "2026-07-01T00:00:00.000Z", actor: "operator", kind: "manual_edit", changed: [], version: 2 },
        { at: "2026-07-05T00:00:00.000Z", actor: "operator", kind: "interview", changed: [], version: 3 },
      ]),
    ).toBe("2026-07-05T00:00:00.000Z");
  });
  it("empty → null", () => {
    expect(lastChange([])).toBeNull();
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-07-08T00:00:00.000Z");
  it("null → em dash", () => {
    expect(relativeTime(null, now)).toBe("—");
  });
  it("formats recent deltas", () => {
    expect(relativeTime("2026-07-07T23:59:30.000Z", now)).toBe("just now");
    expect(relativeTime("2026-07-07T23:00:00.000Z", now)).toBe("1h ago");
    expect(relativeTime("2026-07-06T00:00:00.000Z", now)).toBe("2d ago");
  });
});

describe("typeHint", () => {
  const opts: VendorTypeOption[] = [
    { type: "Infra", mappingCount: 3, vendorCount: 2 },
    { type: "Ops", mappingCount: 0, vendorCount: 1 },
  ];
  it("empty → muted guidance", () => {
    expect(typeHint("", opts).tone).toBe("muted");
  });
  it("served type → ok with count (case-insensitive)", () => {
    const h = typeHint("infra", opts);
    expect(h.tone).toBe("ok");
    expect(h.text).toBe("3 mappings serve Infra — runnable.");
  });
  it("unserved type → warn", () => {
    const h = typeHint("Ops", opts);
    expect(h.tone).toBe("warn");
    expect(h.text).toContain("No mapping serves");
  });
  it("brand-new type → warn", () => {
    expect(typeHint("Fintech", opts).tone).toBe("warn");
  });
});

describe("toComboboxOptions", () => {
  it("labels served types with a mapping count and unserved with 'no mapping yet'", () => {
    const co = toComboboxOptions([
      { type: "Infra", mappingCount: 3, vendorCount: 2 },
      { type: "Ops", mappingCount: 0, vendorCount: 1 },
      { type: "Mktg", mappingCount: 1, vendorCount: 0 },
    ]);
    expect(co).toEqual([
      { value: "Infra", label: "Infra", meta: "3 mappings" },
      { value: "Ops", label: "Ops", meta: "no mapping yet" },
      { value: "Mktg", label: "Mktg", meta: "1 mapping" },
    ]);
  });
});
