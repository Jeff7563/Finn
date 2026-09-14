import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/server/auth";

export default async function RootPage() {
  const user = await getAuthenticatedUser();
  if (user) {
    redirect("/today");
  } else {
    redirect("/login");
  }
}
