import { createClerkClient } from "@clerk/chrome-extension/client";
import { createExtensionApi } from "./api";
import { CLERK_PUBLISHABLE_KEY, CLERK_SYNC_HOST } from "./config";

async function getToken(): Promise<string | null> {
  if (!CLERK_PUBLISHABLE_KEY) return null;
  const clerk = await createClerkClient({
    publishableKey: CLERK_PUBLISHABLE_KEY,
    syncHost: CLERK_SYNC_HOST,
    background: true,
  });
  return clerk.session?.getToken() ?? null;
}

export const backgroundApi = createExtensionApi(getToken);
