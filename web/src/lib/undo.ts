import { ApiError } from "./api";

/** Undo, asking first when the undo would remove a view that has built pieces: the API answers
 * 409 `confirm_undo_view` with the question as its message; "OK" repeats the call with confirm. */
export async function undoAsking<T>(
  call: (confirm: boolean) => Promise<T>,
  ask: (question: string) => boolean,
): Promise<T | null> {
  try {
    return await call(false);
  } catch (e) {
    if (e instanceof ApiError && e.code === "confirm_undo_view") {
      return ask(e.message) ? call(true) : null;
    }
    throw e;
  }
}
