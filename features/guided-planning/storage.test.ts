import { beforeEach, describe, expect, it } from "vitest";
import { addUserMessage, chooseIdea, createProgress } from "./progress";
import { clearConnection, clearVercelToken, loadConnection, loadProgress, loadVercelToken, saveConnection, saveProgress, saveVercelToken } from "./storage";

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

describe("구현·배포 상태 보존", () => {
  it("저장된 저장소 주소와 배포 주소와 단계 상태가 그대로 돌아온다", () => {
    const p = chooseIdea(createProgress(), "a");
    p.delivery = { ...p.delivery, confirmed: true, repoUrl: "https://github.com/u/a", deployUrl: "https://a.vercel.app", verified: true, done: ["generate", "repo", "push"] };
    saveProgress(localStorage, p);
    expect(loadProgress(localStorage).delivery).toEqual(p.delivery);
  });

  it("구현 기능이 생기기 전에 저장된 진행 상황도 읽히고 4·5단계 상태는 처음 값이 된다", () => {
    const old = JSON.parse(JSON.stringify(createProgress()));
    delete old.delivery;
    old.review = { 2: false, 3: true };
    old.projectName = "예전 프로젝트";
    localStorage.setItem("guided-planning:progress", JSON.stringify(old));
    const loaded = loadProgress(localStorage);
    expect(loaded.projectName).toBe("예전 프로젝트");
    expect(loaded.review).toEqual({ 2: false, 3: true, 4: false });
    expect(loaded.delivery.repoUrl).toBeNull();
  });

  it("진행 중이던 구현은 이어지지 않고, 다시 열면 어느 단계에서 중단됐는지가 남는다", () => {
    const p = chooseIdea(createProgress(), "a");
    p.delivery = { ...p.delivery, running: "push", confirmed: true };
    saveProgress(localStorage, p);
    const loaded = loadProgress(localStorage);
    expect(loaded.delivery.running).toBeNull();
    expect(loaded.delivery.interrupted).toBe(true);
    expect(loaded.delivery.error?.step).toBe("push");
  });
});

describe("Vercel 토큰 보관", () => {
  it("이 브라우저에 저장하고 다시 읽으며, 지우면 없어진다. 진행 상황과 따로 보관한다", () => {
    expect(loadVercelToken(localStorage)).toBeNull();
    saveVercelToken(localStorage, { token: "vcp_x", name: "kim" });
    expect(loadVercelToken(localStorage)).toEqual({ token: "vcp_x", name: "kim" });
    const p = chooseIdea(createProgress(), "a");
    saveProgress(localStorage, p);
    clearVercelToken(localStorage);
    expect(loadVercelToken(localStorage)).toBeNull();
    expect(loadProgress(localStorage)).toEqual(p);
  });
});
