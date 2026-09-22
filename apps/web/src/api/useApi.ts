import { useMemo } from "react";
import { authClient } from "../auth-client";
import { createApiClient } from "./client";

export function useApi() {
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? "anonymous";
  return useMemo(() => createApiClient(async () => null, userId), [userId]);
}
