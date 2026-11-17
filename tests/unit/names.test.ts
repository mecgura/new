import { describe, expect, it } from "vitest";
import { cleanPersonName } from "@/lib/names";

describe("cleanPersonName", () => {
  it("decodes quoted-printable names and leaves normal ones alone", () => {
    expect(cleanPersonName("=52=61=6E=69=20=53=61=68=6F=74=61")).toBe("Rani Sahota");
    expect(cleanPersonName("=E0=A8=B8=E0=A8=BF=E0=A9=B1=E0=A8=A7=E0=A9=82")).toBe("ਸਿੱਧੂ");
    expect(cleanPersonName("Guri Singh")).toBe("Guri Singh");
    expect(cleanPersonName("Rs =50 ok")).toBe("Rs =50 ok");
    expect(cleanPersonName("=FF=FE=FD=FC")).toBe("=FF=FE=FD=FC");
  });
});
