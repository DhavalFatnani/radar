"use server";
import { auth } from "@/lib/auth";
import { matchVendors } from "@/lib/catalogue/data";
import type { MatchQuery, MatchedVendor } from "@/lib/catalogue/schema";

async function signedIn(): Promise<boolean> {
  const session = await auth();
  return Boolean(session?.user);
}

export async function matchVendorsAction(query: MatchQuery): Promise<MatchedVendor[]> {
  if (!(await signedIn())) return [];
  return matchVendors(query);
}
