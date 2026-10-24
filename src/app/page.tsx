import { getPrisma } from "@/lib/prisma";
import { ChurchDashboard, type DashboardChurch } from "./church-dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  let churches: DashboardChurch[] = [];
  let unavailable = false;
  try {
    const registered = await getPrisma().church.findMany({
      select: { id: true, name: true, location: true, baptisms2026: true, createdAt: true, updatedAt: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
    });
    churches = registered.map((church) => ({ ...church, id: church.id.toString(), createdAt: church.createdAt.toISOString(), updatedAt: church.updatedAt.toISOString() }));
  } catch {
    unavailable = true;
  }
  return <ChurchDashboard churches={churches} unavailable={unavailable} />;
}
