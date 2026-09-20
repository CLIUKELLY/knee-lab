import { useEffect, useState } from "react";

export type PerformanceMode = "full" | "reduced";

export function usePerformanceMode() {
  const [mode, setMode] = useState<PerformanceMode>(() => {
    if (typeof window === "undefined") return "full";
    return window.matchMedia("(max-width: 680px), (prefers-reduced-motion: reduce)").matches ? "reduced" : "full";
  });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 680px), (prefers-reduced-motion: reduce)");
    const update = () => setMode(media.matches ? "reduced" : "full");
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return mode;
}
