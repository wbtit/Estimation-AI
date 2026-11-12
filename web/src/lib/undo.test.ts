import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { undoAsking } from "./undo";

const question = new ApiError(
  409,
  "Remove View 4 and its 44 pieces?",
  "confirm_undo_view",
);

describe("undoAsking", () => {
  it("does a plain undo with no question", async () => {
    const call = vi.fn().mockResolvedValue("done");
    const ask = vi.fn();
    expect(await undoAsking(call, ask)).toBe("done");
    expect(call).toHaveBeenCalledWith(false);
    expect(ask).not.toHaveBeenCalled();
  });

  it("asks the API's question and repeats with confirm on OK", async () => {
    const call = vi
      .fn()
      .mockRejectedValueOnce(question)
      .mockResolvedValueOnce("removed");
    const ask = vi.fn().mockReturnValue(true);
    expect(await undoAsking(call, ask)).toBe("removed");
    expect(ask).toHaveBeenCalledWith("Remove View 4 and its 44 pieces?");
    expect(call).toHaveBeenLastCalledWith(true);
  });

  it("does nothing on Cancel", async () => {
    const call = vi.fn().mockRejectedValueOnce(question);
    expect(await undoAsking(call, () => false)).toBeNull();
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("passes other errors on", async () => {
    const err = new ApiError(409, "nothing to undo");
    await expect(
      undoAsking(vi.fn().mockRejectedValue(err), () => true),
    ).rejects.toBe(err);
  });
});
