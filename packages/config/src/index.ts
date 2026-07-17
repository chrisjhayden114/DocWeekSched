/**
 * Central product branding / legal config.
 * Rename the product by changing this module only — do not hardcode the name elsewhere.
 */
export const brand = {
  productName: "EventPilot",
  /** Placeholder until rename; keep in sync with public domain. */
  domain: "ukedl.com",
  supportEmail: "cjhayden114@gmail.com",
  legalEntity: "EventPilot (pending rename)",
  logoAlt: "Product logo",
  colors: {
    ink: "#18253F",
    primary: "#0033A0",
    goldDecorative: "#E8C547",
  },
} as const;

export type BrandConfig = typeof brand;
