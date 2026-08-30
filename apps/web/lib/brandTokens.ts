import { brand } from "@event-app/config";

/** Substitute {{product}} / {{support}} / {{hours}} / {{status}} in help and Feature Guide copy. */
export function applyBrandTokens(text: string): string {
  return text
    .replace(/\{\{product\}\}/g, brand.productName)
    .replace(/\{\{support\}\}/g, brand.supportEmail)
    .replace(/\{\{hours\}\}/g, brand.supportHours)
    .replace(/\{\{status\}\}/g, brand.statusPageUrl);
}
