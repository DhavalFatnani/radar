import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/v1/health/route";

describe("GET /api/v1/health", () => {
  it("returns 200 with an ok status payload", async () => {
    const res = await GET();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("radar");
    expect(body.version).toBe("v1");
    expect(typeof body.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });
});
