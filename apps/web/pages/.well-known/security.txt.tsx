import { brand } from "@event-app/config";
import type { GetServerSideProps } from "next";

/** RFC 9116 security.txt — contact and policy from branding config. */
export const getServerSideProps: GetServerSideProps = async ({ res }) => {
  const expires = new Date();
  expires.setUTCFullYear(expires.getUTCFullYear() + 1);
  const body = `Contact: mailto:${brand.supportEmail}
Expires: ${expires.toISOString()}
Preferred-Languages: en
Canonical: ${brand.primaryUrl}/.well-known/security.txt
Policy: ${brand.primaryUrl}/security
Acknowledgments: ${brand.primaryUrl}/security
`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.write(body);
  res.end();
  return { props: {} };
};

export default function SecurityTxt() {
  return null;
}
