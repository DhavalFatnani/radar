// Healthcheck — app liveness only. No DB or external dependency (Slice 1 scope).
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json({
    status: "ok",
    service: "radar",
    version: "v1",
    timestamp: new Date().toISOString(),
  });
}
