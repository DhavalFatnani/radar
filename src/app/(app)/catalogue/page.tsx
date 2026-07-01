import { PageHeader } from "@/app/components/ui/page-header";
import { EmptyState } from "@/app/components/ui/empty-state";
import { getCatalogueGraph } from "@/lib/catalogue/data";
import { CatalogueView } from "./catalogue-view";

export const metadata = { title: "Catalogue — Radar" };

export default async function CataloguePage() {
  const graph = await getCatalogueGraph();
  return (
    <>
      <PageHeader eyebrow="Build" title="Catalogue" />
      {graph.nodes.length === 0 ? (
        <EmptyState
          icon="catalogue"
          title="No vendors in the catalogue yet"
          description="Save a vendor profile — its capabilities and geographies will appear here as a connected network."
        />
      ) : (
        <CatalogueView graph={graph} />
      )}
    </>
  );
}
