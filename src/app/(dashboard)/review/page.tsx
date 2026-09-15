import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { ReviewInboxClient } from "@/components/slips/ReviewInboxClient";

export const dynamic = "force-dynamic";

export default async function ReviewPage() {
  const user = await requireUser();

  const [pendingSlips, accounts, categories, merchants, people] =
    await Promise.all([
      DataStore.getPendingReviewSlips(user.id),
      DataStore.getAccounts(user.id),
      DataStore.getCategories(user.id),
      DataStore.getMerchants(user.id),
      DataStore.getPeople(user.id),
    ]);

  return (
    <ReviewInboxClient
      userId={user.id}
      initialSlips={pendingSlips}
      accounts={accounts}
      categories={categories}
      merchants={merchants}
      people={people}
    />
  );
}
