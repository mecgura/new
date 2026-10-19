import { describe, expect, it } from "vitest";
import { parseVcf } from "@/services/inbox/contacts";

describe("vCard (.vcf) parsing", () => {
  it("reads Google/Android style cards, several numbers, folded lines and escapes", () => {
    const vcf = [
      "BEGIN:VCARD", "VERSION:3.0", "FN:Asha Kaur", "N:Kaur;Asha;;;", "TEL;TYPE=CELL:+91 98765 43210", "TEL;TYPE=WORK:0172-2222222", "EMAIL;TYPE=INTERNET:asha@example.com", "END:VCARD",
      "BEGIN:VCARD", "VERSION:3.0", "FN:Rahul\\, Sharma", "TEL;TYPE=CELL:98123", " 45678", "END:VCARD",
    ].join("\r\n");
    expect(parseVcf(vcf)).toEqual([
      ["name", "phone", "email"],
      ["Asha Kaur", "+91 98765 43210", "asha@example.com"],
      ["Asha Kaur", "0172-2222222", "asha@example.com"],
      ["Rahul, Sharma", "9812345678", ""],
    ]);
  });

  it("reads Apple style cards (item prefixes, tel: URIs) and falls back to the N field when FN is missing", () => {
    const vcf = "BEGIN:VCARD\nVERSION:3.0\nN:Singh;Gurpreet;;;\nitem1.TEL;type=pref:+919876500000\nitem2.TEL;VALUE=uri:tel:+91-98765-11111\nEND:VCARD\n";
    expect(parseVcf(vcf)).toEqual([
      ["name", "phone", "email"],
      ["Gurpreet Singh", "+919876500000", ""],
      ["Gurpreet Singh", "+91-98765-11111", ""],
    ]);
  });

  it("skips cards without a phone number and tolerates junk", () => {
    expect(parseVcf("BEGIN:VCARD\nFN:No Phone\nEMAIL:a@b.co\nEND:VCARD\nrandom text")).toEqual([["name", "phone", "email"]]);
    expect(parseVcf("")).toEqual([["name", "phone", "email"]]);
  });
});

import { stripVcfBinary } from "@/lib/vcf";

describe("stripVcfBinary", () => {
  it("drops folded base64 photos but keeps names, numbers and emails", () => {
    const photo = "A".repeat(200);
    const vcf = ["BEGIN:VCARD", "VERSION:3.0", "FN:Asha", `PHOTO;ENCODING=b;TYPE=JPEG:${photo.slice(0, 60)}`, ` ${photo.slice(60, 130)}`, ` ${photo.slice(130)}`, "TEL:+919876543210", "item2.PHOTO;X=1:abc", "EMAIL:a@b.co", "END:VCARD", ""].join("\r\n");
    const out = stripVcfBinary(vcf);
    expect(out).not.toContain("AAAA");
    expect(out).not.toContain("PHOTO");
    expect(out).toContain("FN:Asha");
    expect(out).toContain("TEL:+919876543210");
    expect(out).toContain("EMAIL:a@b.co");
    expect(parseVcf(out)).toEqual([["name", "phone", "email"], ["Asha", "+919876543210", "a@b.co"]]);
  });
});
