/**
 * @vitest-environment jsdom
 *
 * Cookie is the value the server compares. sessionStorage can lag after a
 * rotation — getCsrfToken must prefer the cookie.
 */

import { afterEach, describe, expect, it } from "vitest";
import { getCsrfToken, setCsrfToken } from "../lib/api";

function clearCsrfCookie() {
  document.cookie = "ep_csrf=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/";
}

afterEach(() => {
  window.sessionStorage.removeItem("ep_csrf");
  clearCsrfCookie();
});

describe("getCsrfToken — cookie wins over sessionStorage", () => {
  it("returns the cookie when cookie and sessionStorage disagree", () => {
    window.sessionStorage.setItem("ep_csrf", "stale-from-storage");
    document.cookie = "ep_csrf=current-from-cookie";
    expect(getCsrfToken()).toBe("current-from-cookie");
  });

  it("falls back to sessionStorage when there is no cookie", () => {
    window.sessionStorage.setItem("ep_csrf", "storage-only");
    expect(getCsrfToken()).toBe("storage-only");
  });

  it("setCsrfToken still writes sessionStorage only", () => {
    document.cookie = "ep_csrf=cookie-stays";
    setCsrfToken("new-from-login");
    expect(window.sessionStorage.getItem("ep_csrf")).toBe("new-from-login");
    expect(getCsrfToken()).toBe("cookie-stays");
  });
});
