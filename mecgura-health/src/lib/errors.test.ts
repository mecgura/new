import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AppError, toFailure } from "./errors";

describe("toFailure", () => {
  it("maps AppError to its status and safe message", () => {
    const { failure, status } = toFailure(new AppError("FORBIDDEN"), "r1");
    expect(status).toBe(403);
    expect(failure.error.code).toBe("FORBIDDEN");
    expect(failure.error.requestId).toBe("r1");
  });
  it("maps ZodError to VALIDATION_ERROR", () => {
    const r = z.object({ a: z.string() }).safeParse({});
    const { failure, status } = toFailure(r.error);
    expect(status).toBe(400);
    expect(failure.error.fieldErrors).toHaveProperty("a");
  });
  it("never leaks internal error details", () => {
    const { failure, status, unexpected } = toFailure(new Error("SELECT * FROM secret_table failed at /srv/app"));
    expect(unexpected).toBe(true);
    expect(status).toBe(500);
    expect(JSON.stringify(failure)).not.toContain("secret_table");
  });
});
