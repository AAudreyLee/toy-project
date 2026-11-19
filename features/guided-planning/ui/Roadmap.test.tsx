import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

import { chooseIdea, createProgress, finishDirection, finishSpec, stepViews } from "../progress";
import { Roadmap } from "./Roadmap";

test("4·5단계가 잠겨 있을 때만 먼저 Spec을 확정하라는 안내를 보여 준다", () => {
  render(<Roadmap steps={stepViews(chooseIdea(createProgress(), "a"))} onOpen={() => {}} />);
  expect(screen.getByText(/먼저 Spec을 확정해 주세요/)).toBeInTheDocument();
});

test("3단계를 확정해 4·5단계가 열리면 그 안내를 숨기고, 4단계를 눌러 들어갈 수 있다", async () => {
  const done = finishSpec(finishDirection(chooseIdea(createProgress(), "a")));
  const onOpen = vi.fn();
  render(<Roadmap steps={stepViews(done)} onOpen={onOpen} />);
  expect(screen.queryByText(/먼저 Spec을 확정해 주세요/)).not.toBeInTheDocument();
  await userEvent.setup().click(screen.getByRole("button", { name: /4단계.*구현/ }));
  expect(onOpen).toHaveBeenCalledWith(4);
});
