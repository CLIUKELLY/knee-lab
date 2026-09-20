import { useEffect, useRef, useState } from "react";

export function useVisibleCanvas(rootMargin = "180px") {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }

    let hideTimer: number | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        if (hideTimer !== undefined) window.clearTimeout(hideTimer);
        setVisible(true);
        return;
      }

      hideTimer = window.setTimeout(() => setVisible(false), 600);
    }, { rootMargin });
    observer.observe(element);
    return () => {
      observer.disconnect();
      if (hideTimer !== undefined) window.clearTimeout(hideTimer);
    };
  }, [rootMargin]);

  return { ref, visible };
}
