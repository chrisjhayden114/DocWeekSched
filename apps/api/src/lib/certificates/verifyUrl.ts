import { publicWebBaseUrl } from "../webBaseUrl";

/**
 * Public verification URL for an issued certificate.
 *
 * Shared by the PDF (which prints it under the id) and the "certificate ready"
 * email (which links it) so a certificate can never carry a URL the email does
 * not, or point at a host the deploy has moved off.
 */
export function certificateVerifyUrl(publicId: string): string {
  return `${publicWebBaseUrl()}/verify/${encodeURIComponent(publicId)}`;
}
