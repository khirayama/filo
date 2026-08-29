import { useMemo } from "react";
import { createApiClient } from "./client";

export function useApi() {
  return useMemo(() => createApiClient(async () => null), []);
}
