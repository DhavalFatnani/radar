import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { catalogueNodes, catalogueEdges, vendorProfiles } from "@/db/schema";
import type { VendorConstraints } from "@/lib/vendors/schema";
import {
  EDGE_VENDOR_CAPABILITY,
  EDGE_VENDOR_GEOGRAPHY,
  type CatalogueGraph,
  type CatalogueNodeType,
  type MatchQuery,
  type MatchedVendor,
} from "./schema";

// Read the whole persisted graph for rendering. Explicit columns; bounded.
export async function getCatalogueGraph(): Promise<CatalogueGraph> {
  const nodes = await db
    .select({
      nodeId: catalogueNodes.nodeId,
      type: catalogueNodes.type,
      label: catalogueNodes.label,
      metadata: catalogueNodes.metadata,
    })
    .from(catalogueNodes)
    .limit(1000);
  const edges = await db
    .select({
      edgeId: catalogueEdges.edgeId,
      fromNodeId: catalogueEdges.fromNodeId,
      toNodeId: catalogueEdges.toNodeId,
      type: catalogueEdges.type,
    })
    .from(catalogueEdges)
    .limit(4000);
  return {
    nodes: nodes.map((n) => ({
      nodeId: n.nodeId,
      type: n.type,
      label: n.label,
      metadata: (n.metadata as Record<string, unknown> | null) ?? null,
    })),
    edges,
  };
}

// Idempotently project ONE vendor's profile into the graph (transactional).
export async function populateCatalogueFromProfile(vendorId: string): Promise<void> {
  const [row] = await db
    .select({
      name: vendorProfiles.name,
      capabilities: vendorProfiles.capabilities,
      constraints: vendorProfiles.constraints,
    })
    .from(vendorProfiles)
    .where(eq(vendorProfiles.vendorId, vendorId))
    .limit(1);
  if (!row) return;

  const constraints = row.constraints as VendorConstraints | null;
  const capabilities = row.capabilities ?? [];
  const geographies = constraints?.geographies ?? [];
  const size = constraints?.maxProjectSize ?? constraints?.minProjectSize ?? undefined;
  const vendorMetadata: { vendorId: string; size?: string } = size ? { vendorId, size } : { vendorId };

  await db.transaction(async (tx) => {
    // 1. find-or-create the vendor node (identity = metadata.vendorId)
    const [existing] = await tx
      .select({ nodeId: catalogueNodes.nodeId })
      .from(catalogueNodes)
      .where(and(eq(catalogueNodes.type, "vendor"), sql`${catalogueNodes.metadata}->>'vendorId' = ${vendorId}`))
      .limit(1);

    let vendorNodeId: string;
    if (existing) {
      vendorNodeId = existing.nodeId;
      await tx
        .update(catalogueNodes)
        .set({ label: row.name, metadata: vendorMetadata })
        .where(eq(catalogueNodes.nodeId, vendorNodeId));
    } else {
      const [inserted] = await tx
        .insert(catalogueNodes)
        .values({ type: "vendor", label: row.name, metadata: vendorMetadata })
        .returning({ nodeId: catalogueNodes.nodeId });
      vendorNodeId = inserted.nodeId;
    }

    // 2. clean slate: drop this vendor's outgoing edges
    await tx.delete(catalogueEdges).where(eq(catalogueEdges.fromNodeId, vendorNodeId));

    // 3 + 4. find-or-create capability/geography nodes and connect them
    async function connect(type: "capability" | "geography", labels: string[], edgeType: string) {
      for (const label of labels) {
        const [node] = await tx
          .select({ nodeId: catalogueNodes.nodeId })
          .from(catalogueNodes)
          .where(and(eq(catalogueNodes.type, type), eq(catalogueNodes.label, label)))
          .limit(1);
        let toNodeId: string;
        if (node) {
          toNodeId = node.nodeId;
        } else {
          const [ins] = await tx
            .insert(catalogueNodes)
            .values({ type, label, metadata: null })
            .returning({ nodeId: catalogueNodes.nodeId });
          toNodeId = ins.nodeId;
        }
        await tx.insert(catalogueEdges).values({ fromNodeId: vendorNodeId, toNodeId, type: edgeType });
      }
    }
    await connect("capability", capabilities, EDGE_VENDOR_CAPABILITY);
    await connect("geography", geographies, EDGE_VENDOR_GEOGRAPHY);

    // 5. prune capability/geography nodes that no longer have any incoming edge
    await tx.delete(catalogueNodes).where(
      and(
        inArray(catalogueNodes.type, ["capability", "geography"]),
        sql`NOT EXISTS (SELECT 1 FROM ${catalogueEdges} WHERE ${catalogueEdges.toNodeId} = ${catalogueNodes.nodeId})`,
      ),
    );
  });
}

// Matchmaking: vendors adjacent to the capability AND/OR geography (spec §4.6).
export async function matchVendors(q: MatchQuery): Promise<MatchedVendor[]> {
  const capability = q.capability?.trim();
  const geography = q.geography?.trim();
  if (!capability && !geography) return [];

  async function vendorNodesAdjacentTo(type: CatalogueNodeType, label: string, edgeType: string) {
    const rows = await db
      .select({ vendorNodeId: catalogueEdges.fromNodeId })
      .from(catalogueEdges)
      .innerJoin(catalogueNodes, eq(catalogueEdges.toNodeId, catalogueNodes.nodeId))
      .where(
        and(
          eq(catalogueEdges.type, edgeType),
          eq(catalogueNodes.type, type),
          sql`lower(${catalogueNodes.label}) = lower(${label})`,
        ),
      )
      .limit(1000);
    return new Set(rows.map((r) => r.vendorNodeId));
  }

  const sets: Set<string>[] = [];
  if (capability) sets.push(await vendorNodesAdjacentTo("capability", capability, EDGE_VENDOR_CAPABILITY));
  if (geography) sets.push(await vendorNodesAdjacentTo("geography", geography, EDGE_VENDOR_GEOGRAPHY));

  let ids = sets[0];
  for (let i = 1; i < sets.length; i++) ids = new Set([...ids].filter((x) => sets[i].has(x)));
  if (ids.size === 0) return [];

  const vendorNodes = await db
    .select({ metadata: catalogueNodes.metadata, label: catalogueNodes.label })
    .from(catalogueNodes)
    .where(inArray(catalogueNodes.nodeId, [...ids]))
    .limit(1000);

  return vendorNodes
    .map((n) => ({
      vendorId: String((n.metadata as { vendorId?: string } | null)?.vendorId ?? ""),
      name: n.label,
    }))
    .filter((v) => v.vendorId)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Backfill: project every vendor (for vendors created before this slice). Sequential.
export async function rebuildCatalogue(): Promise<{ vendors: number }> {
  const rows = await db.select({ vendorId: vendorProfiles.vendorId }).from(vendorProfiles).limit(1000);
  for (const { vendorId } of rows) await populateCatalogueFromProfile(vendorId);
  return { vendors: rows.length };
}
