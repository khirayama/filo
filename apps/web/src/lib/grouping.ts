import type { Subscription, Tag } from "../api/types";

export interface SubscriptionGroup {
  key: number | "untagged";
  label: string;
  tag?: Tag;
  items: Subscription[];
}

// Groups subscriptions by tag (in tag order), with untagged ones last.
export function groupSubscriptionsByTag(tags: Tag[], subscriptions: Subscription[]): SubscriptionGroup[] {
  return [
    ...tags.map((tag) => ({
      key: tag.id as number | "untagged",
      label: tag.name,
      tag,
      items: subscriptions.filter((s) => s.tagIds.includes(tag.id)),
    })),
    { key: "untagged" as const, label: "タグなし", items: subscriptions.filter((s) => s.tagIds.length === 0) },
  ];
}
