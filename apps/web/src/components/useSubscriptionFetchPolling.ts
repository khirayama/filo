import { useEffect, useRef } from "react";
import type { ApiClient } from "../api/client";
import type { Subscription } from "../api/types";

const POLL_INTERVAL_MS = 3000;
// The job gives up long before this; stop rather than poll a lost job forever.
const MAX_POLLS = 60;

// A new subscription fetches its first articles in the background. Follow it
// so the screen shows the result without the user having to reload.
export function useSubscriptionFetchPolling(
  api: Pick<ApiClient, "getSubscription" | "invalidateFeedData">,
  subscription: Subscription | null,
  onSettled: (subscription: Subscription) => void,
) {
  const latestOnSettled = useRef(onSettled);
  latestOnSettled.current = onSettled;
  const id = subscription?.id;
  const fetching = subscription?.initialFetchStatus === "fetching";

  useEffect(() => {
    if (id === undefined || !fetching) return;
    let polls = 0;
    let disposed = false;
    const timer = window.setInterval(() => {
      polls += 1;
      if (polls > MAX_POLLS) {
        window.clearInterval(timer);
        return;
      }
      void api.getSubscription(id).then((next) => {
        if (disposed || next.initialFetchStatus === "fetching") return;
        window.clearInterval(timer);
        // Anything read while the job ran is older than its result.
        api.invalidateFeedData();
        latestOnSettled.current(next);
      }, () => undefined);
    }, POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [api, fetching, id]);
}
