/**
 * @vitest-environment jsdom
 *
 * CERT-1 — public /verify/[id] page: valid card, unknown id, API unreachable.
 */

import { act, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const routerState = {
  isReady: true,
  pathname: "/verify/[id]",
  query: { id: "cert_valid" } as Record<string, string | string[] | undefined>,
  push: vi.fn(),
};

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/head", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("next/router", () => ({
  useRouter: () => routerState,
}));

vi.mock("../lib/api", () => ({
  API_URL: "http://localhost:4000",
}));

import CertificateVerifyPage from "../pages/verify/[id]";

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  routerState.isReady = true;
  routerState.query = { id: "cert_valid" };
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function render(element: ReactElement) {
  act(() => root.render(element));
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

const VALID = {
  attendeeName: "Ada Lovelace",
  eventName: "Northbridge Institute 2026",
  date: "2026-07-01",
  hours: 12.5,
  issuedAt: "2026-07-04",
  certificateId: "cert_valid",
};

describe("certificate verify page", () => {
  it("valid: confirmation card with name, event, dates, hours, issued date, id", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => VALID,
    });
    render(<CertificateVerifyPage />);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/verify/cert_valid",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(container.textContent).toContain("This certificate is valid");
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Northbridge Institute 2026");
    expect(container.textContent).toContain("July 1, 2026");
    expect(container.textContent).toContain("12.5 hours");
    expect(container.textContent).toContain("July 4, 2026");
    expect(container.textContent).toContain("cert_valid");
    expect(container.querySelector('meta[name="robots"]')?.getAttribute("content")).toBe("noindex");
    expect(container.textContent).not.toContain("We couldn't verify this certificate");
  });

  it("unknown/invalid id: honest miss, no API detail leakage", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: "Not found", voided: true, attendeeName: "should-not-leak" }),
    });
    routerState.query = { id: "forged-id" };
    render(<CertificateVerifyPage />);
    await flush();
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/verify/forged-id",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(container.textContent).toContain("We couldn't verify this certificate");
    expect(container.textContent).not.toContain("should-not-leak");
    expect(container.textContent).not.toContain("Not found");
    expect(container.textContent).not.toContain("voided");
    expect(container.textContent).not.toContain("Ada Lovelace");
  });

  it("API unreachable: retry message, retry calls again", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<CertificateVerifyPage />);
    await flush();
    expect(container.textContent).toContain("We couldn't check this certificate");
    expect(container.textContent).toMatch(/try again/i);
    expect(container.textContent).not.toContain("We couldn't verify this certificate");

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => VALID,
    });
    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain("This certificate is valid");
    expect(container.textContent).toContain("Ada Lovelace");
  });
});
