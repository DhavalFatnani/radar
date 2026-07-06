import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { LandingHero } from "./landing-hero";

export default async function HomePage() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");
  return <LandingHero />;
}
