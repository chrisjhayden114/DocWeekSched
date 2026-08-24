import { ReactNode, useEffect, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";

/** document.body does not exist during the server render, where useLayoutEffect
 *  also warns; on the client the layout effect gets the children on screen in
 *  the same frame, which dropdowns need and overlays don't mind. */
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Renders children into document.body so fixed-position overlays escape any
 *  overflow or transformed ancestor that would otherwise clip or trap them. */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useIsomorphicLayoutEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
