import { notFound } from "next/navigation";
import { getVendor } from "@/lib/vendors/data";
import { getActiveInterview, listInterviews } from "@/lib/interviews/data";
import { turnView } from "./view";
import { InterviewScreen } from "./interview-screen";

export const metadata = { title: "SIA Interview — Radar" };

export default async function InterviewPage({
  params,
}: {
  params: Promise<{ vendorId: string }>;
}) {
  const { vendorId } = await params;
  const vendor = await getVendor(vendorId);
  if (!vendor) notFound();

  const active = await getActiveInterview(vendorId);
  const past = await listInterviews(vendorId);
  const initialTurn = active ? turnView(active.interviewId, active.messages, vendor) : null;

  return <InterviewScreen vendor={vendor} initialTurn={initialTurn} past={past} />;
}
