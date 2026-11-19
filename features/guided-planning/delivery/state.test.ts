import { describe, expect, it } from "vitest";
import {
  beginRun,
  createDelivery,
  failRun,
  finishRun,
  interruptIfRunning,
  isValidRepoName,
  proposeRepoName,
  stepDone,
  stepStarted,
  userFacingStage,
} from "./state";

describe("저장소 이름 제안", () => {
  it("영문 프로젝트 이름은 소문자와 하이픈으로 바꾼다", () => {
    expect(proposeRepoName("Morning Dust Alert")).toBe("morning-dust-alert");
    expect(proposeRepoName("  My_App!! v2 ")).toBe("my-app-v2");
  });

  it("한글만 있는 이름은 같은 입력이면 같은 값이 나오는 기본 이름으로 제안한다", () => {
    const a = proposeRepoName("아침 미세먼지 알림");
    expect(a).toMatch(/^my-service-[a-z0-9]{4}$/);
    expect(proposeRepoName("아침 미세먼지 알림")).toBe(a);
    expect(proposeRepoName("주말 날씨 리포트")).not.toBe(a);
  });

  it("제안한 이름은 항상 GitHub 저장소 이름 규칙을 지킨다", () => {
    for (const n of ["Morning Dust Alert", "아침 알림", "", "...", "A".repeat(200)]) {
      expect(isValidRepoName(proposeRepoName(n))).toBe(true);
    }
  });

  it("저장소 이름 규칙: 영문 숫자 하이픈 밑줄 점만, 100자 이하, 빈 값과 점으로만 된 이름 불가", () => {
    expect(isValidRepoName("ok-name_1.0")).toBe(true);
    for (const bad of ["", " ", "한글", "has space", ".", "..", "a/b", "x".repeat(101)]) expect(isValidRepoName(bad)).toBe(false);
  });
});

describe("구현·배포 진행 상태", () => {
  it("실행을 시작하면 확인한 이름이 저장되고 이전 오류가 지워진다", () => {
    const failed = failRun(beginRun(createDelivery("a"), "first"), "repo", "name-taken", "이미 있어요");
    const again = beginRun(failed, "second");
    expect(again.repoName).toBe("second");
    expect(again.confirmed).toBe(true);
    expect(again.error).toBeNull();
  });

  it("단계가 끝나면 완료 목록에 쌓이고 지금 하는 일이 바뀐다", () => {
    let d = beginRun(createDelivery("a"), "a");
    d = stepStarted(d, "generate");
    expect(d.running).toBe("generate");
    d = stepDone(d, "generate", {});
    expect(d.done).toEqual(["generate"]);
    expect(d.running).toBeNull();
    d = stepDone(stepStarted(d, "repo"), "repo", { repoUrl: "https://github.com/u/a" });
    expect(d.repoUrl).toBe("https://github.com/u/a");
    expect(d.done).toEqual(["generate", "repo"]);
  });

  it("실패하면 어느 단계에서 왜 실패했는지 남기고 지금 하는 일은 멈춘다", () => {
    const d = failRun(stepStarted(beginRun(createDelivery("a"), "a"), "deploy"), "deploy", "build", "빌드가 실패했어요");
    expect(d.running).toBeNull();
    expect(d.error).toEqual({ step: "deploy", code: "build", message: "빌드가 실패했어요" });
  });

  it("모든 단계가 끝나 확인이 되면 완료로 표시한다", () => {
    const d = finishRun(stepDone(stepStarted(beginRun(createDelivery("a"), "a"), "verify"), "verify", { deployUrl: "https://x.vercel.app" }));
    expect(d.verified).toBe(true);
    expect(d.deployUrl).toBe("https://x.vercel.app");
  });

  it("새로고침 때 진행 중이던 단계는 중단됨으로 바뀌고 어느 단계였는지 남는다", () => {
    const running = stepStarted(beginRun(createDelivery("a"), "a"), "push");
    const reloaded = interruptIfRunning(running);
    expect(reloaded.running).toBeNull();
    expect(reloaded.interrupted).toBe(true);
    expect(reloaded.error?.step).toBe("push");
    expect(interruptIfRunning(createDelivery("a")).interrupted).toBe(false);
  });

  it("사용자에게 보이는 일은 코드 만들기, 저장소 만들기, 올리기, 배포, 확인 다섯 가지다", () => {
    expect(["generate", "repo", "push", "project", "deploy", "verify"].map((s) => userFacingStage(s as never))).toEqual([
      "코드 만드는 중",
      "저장소 만드는 중",
      "올리는 중",
      "배포 중",
      "배포 중",
      "확인 중",
    ]);
  });
});
