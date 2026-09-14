import React from "react";
import { requireUser } from "@/lib/server/auth";
import { DataStore } from "@/lib/server/data-store";
import { calculateAllPeopleSummaries } from "@/lib/finance/people";
import { PeopleClient } from "@/components/people/PeopleClient";
import { PageHeader } from "@/components/ui/PageHeader";

export default async function PeoplePage() {
  const user = await requireUser();

  const [people, transactions] = await Promise.all([
    DataStore.getPeople(user.id),
    DataStore.getTransactions(user.id),
  ]);

  const summaries = calculateAllPeopleSummaries(people, transactions);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <PageHeader
        title="People"
        description="Individuals you send money to or receive money from."
      />

      <PeopleClient initialSummaries={summaries} />
    </div>
  );
}
