import { ReactNode, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Renders children into document.body so fixed-position overlays escape any
 *  transformed ancestor that would otherwise trap position:fixed. */
export function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(children, document.body);
}
