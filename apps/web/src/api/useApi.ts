import { useAuth } from "@clerk/clerk-react";
import { useEffect, useMemo, useRef } from "react";
import { createApiClient } from "./client";

export function useApi() {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  useEffect(() => {
    getTokenRef.current = getToken;
  }, [getToken]);
  return useMemo(() => createApiClient(() => getTokenRef.current()), []);
}
