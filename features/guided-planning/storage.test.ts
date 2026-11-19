import { beforeEach, describe, expect, it } from "vitest";
import { addUserMessage, chooseIdea, createProgress } from "./progress";
import { clearConnection, loadConnection, loadProgress, saveConnection, saveProgress } from "./storage";

beforeEach(() => localStorage.clear());

describe("진행 상황 보존", () => {
  it("저장한 진행 상황을 다시 열면 마지막 단계, 대화, 문서, 단계별 상태가 그대로 돌아온다", () => {
    let p = chooseIdea(createProgress(), "아침 미세먼지 알림");
    p = addUserMessage(p, "direction", "직장인이요");
    p.direction.doc.oneLine = "한 줄";
    saveProgress(localStorage, p);
    expect(loadProgress(localStorage)).toEqual(p);
  });

  it("저장된 것이 없거나 깨져 있으면 처음 상태로 시작한다", () => {
    expect(loadProgress(localStorage)).toEqual(createProgress());
    localStorage.setItem("guided-planning:progress", "{깨진 json");
    expect(loadProgress(localStorage)).toEqual(createProgress());
    localStorage.setItem("guided-planning:progress", JSON.stringify({ view: "spec" }));
    expect(loadProgress(localStorage)).toEqual(createProgress());
  });
});

describe("연결 정보 보관", () => {
  const conn = { apiKey: "k", endpoint: "https://x.openai.azure.com", deployment: "d" };

  it("이 브라우저에 저장하고 다시 읽으며, 지우면 없어진다", () => {
    expect(loadConnection(localStorage)).toBeNull();
    saveConnection(localStorage, conn);
    expect(loadConnection(localStorage)).toEqual(conn);
    clearConnection(localStorage);
    expect(loadConnection(localStorage)).toBeNull();
  });

  it("연결 정보를 바꿔도 진행 상황은 그대로 남는다", () => {
    const p = chooseIdea(createProgress(), "a");
    saveProgress(localStorage, p);
    saveConnection(localStorage, conn);
    saveConnection(localStorage, { ...conn, apiKey: "새 키" });
    expect(loadProgress(localStorage)).toEqual(p);
  });
});
