import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";

export function useBackOr(fallback: string): () => void {
  const location = useLocation();
  const navigate = useNavigate();
  return useCallback(() => {
    if (location.key === "default") navigate(fallback, { replace: true });
    else navigate(-1);
  }, [fallback, location.key, navigate]);
}
