import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import Home from "@/app/page";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

// 2026-11-19 사용자 결정: 서비스를 쓰는 사람이 한 명뿐이라 서버의 .env.local 키를 쓰고 시작 화면의 키 입력은 생략한다.
test("연결 정보가 저장되어 있지 않아도 키 입력 화면 없이 바로 만들 것 찾기 화면이 보인다", async () => {
  render(<Home />);
  expect(await screen.findByText("무엇을 만들고 싶으세요?")).toBeInTheDocument();
  expect(screen.queryByLabelText("Azure OpenAI API 키")).not.toBeInTheDocument();
});

test("API 키 변경을 누르면 키, 엔드포인트, 배포 이름 입력란이 보인다", async () => {
  const user = userEvent.setup();
  render(<Home />);
  await user.click(await screen.findByRole("button", { name: "API 키 변경" }));
  expect(await screen.findByLabelText("Azure OpenAI API 키")).toBeInTheDocument();
  expect(screen.getByLabelText("엔드포인트 주소")).toBeInTheDocument();
  expect(screen.getByLabelText("배포 이름")).toBeInTheDocument();
});

test("입력란이 비어 있으면 키를 확인하지 못했다고 알리고 다음 화면으로 넘어가지 않는다", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<Home />);
  await user.click(await screen.findByRole("button", { name: "API 키 변경" }));
  await user.click(await screen.findByRole("button", { name: "시작하기" }));
  expect(screen.getByText("키를 확인하지 못했어요")).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.queryByText("무엇을 만들고 싶으세요?")).not.toBeInTheDocument();
});

test("키 확인이 실패하면 키를 확인하지 못했다고 알리고, 성공하면 만들 것 찾기 화면으로 간다", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ ok: false, code: "key", message: "x" }, { status: 502 }))
    .mockResolvedValueOnce(Response.json({ ok: true, kind: "verify" }));
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<Home />);
  await user.click(await screen.findByRole("button", { name: "API 키 변경" }));
  await user.type(await screen.findByLabelText("Azure OpenAI API 키"), "k");
  await user.type(screen.getByLabelText("엔드포인트 주소"), "https://a.openai.azure.com");
  await user.type(screen.getByLabelText("배포 이름"), "d");
  await user.click(screen.getByRole("button", { name: "시작하기" }));
  expect(await screen.findByText("키를 확인하지 못했어요")).toBeInTheDocument();
  expect(screen.queryByText("무엇을 만들고 싶으세요?")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "시작하기" }));
  await waitFor(() => expect(screen.getByText("무엇을 만들고 싶으세요?")).toBeInTheDocument());
  expect(JSON.parse(localStorage.getItem("guided-planning:connection")!).apiKey).toBe("k");
});

test("아이디어가 비었을 때 시작하면 넘어가지 않고 무엇을 적으면 되는지 알려 준다", async () => {
  localStorage.setItem(
    "guided-planning:connection",
    JSON.stringify({ apiKey: "k", endpoint: "https://a.openai.azure.com", deployment: "d" }),
  );
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();
  render(<Home />);
  await user.click(await screen.findByRole("button", { name: "이 아이디어로 시작" }));
  expect(screen.getByText(/한 줄로 적어 주세요/)).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
});

test("재료를 하나도 고르지 않으면 아이디어 받기를 누를 수 없다", async () => {
  localStorage.setItem(
    "guided-planning:connection",
    JSON.stringify({ apiKey: "k", endpoint: "https://a.openai.azure.com", deployment: "d" }),
  );
  const user = userEvent.setup();
  render(<Home />);
  await user.click(await screen.findByRole("button", { name: "쓸 수 있는 재료 보기" }));
  for (const group of ["공개 데이터", "AI가 하는 일", "저장과 로그인", "알림"]) {
    expect(screen.getByRole("heading", { name: group })).toBeInTheDocument();
  }
  const get = screen.getByRole("button", { name: "고른 재료로 아이디어 받기" });
  expect(get).toBeDisabled();
  await user.click(screen.getByRole("button", { name: "환율" }));
  expect(get).toBeEnabled();
});
