// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NameGate } from "./NameGate";

afterEach(cleanup);

describe("NameGate", () => {
  it("does not let a blank name through", () => {
    const onSubmit = vi.fn();
    render(<NameGate onSubmit={onSubmit} />);
    const start = screen.getByText("Start") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("enter your name to start"), {
      target: { value: "   " },
    });
    expect(start.disabled).toBe(true);
    fireEvent.submit(start.closest("form") as HTMLFormElement);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("hands back the trimmed name once", () => {
    const onSubmit = vi.fn();
    render(<NameGate onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText("enter your name to start"), {
      target: { value: "  alice " },
    });
    fireEvent.click(screen.getByText("Start"));
    expect(onSubmit).toHaveBeenCalledWith("alice");
  });
});
