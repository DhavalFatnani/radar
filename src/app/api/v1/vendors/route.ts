import { auth } from "@/lib/auth";
import { listVendors } from "@/lib/vendors/data";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user) {
    return Response.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
  }
  try {
    const data = await listVendors();
    return Response.json({ data });
  } catch {
    return Response.json({ error: "Internal error", code: "INTERNAL_ERROR" }, { status: 500 });
  }
}
