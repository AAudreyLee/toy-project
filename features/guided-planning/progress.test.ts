import { describe, expect, it } from "vitest";
import {
  addUserMessage,
  applyAgentReply,
  chooseIdea,
  createProgress,
  finishDirection,
  finishSpec,
  nextAction,
  openStep,
  resolveReview,
  showEditNotice,
  stepViews,
} from "./progress";

const reply = (message: string, doc = {}) => ({ message, doc });

function throughSpecDone() {
  let p = chooseIdea(createProgress(), "아침 미세먼지 알림");
  p = applyAgentReply(p, "direction", reply("누가 받나요?", { oneLine: "아침 알림", promisedChange: "고민 없이 출근" }));
  p = finishDirection(p);
  p = applyAgentReply(p, "spec", reply("이 결과로 갈까요?", { result: "알림 한 통을 받는다", scope: ["동네 등록"] }));
  return finishSpec(p);
}

describe("로드맵 단계 상태", () => {
  it("처음에는 1단계가 지금이고, 4·5단계는 잠김이며 누를 수 없다", () => {
    const steps = stepViews(createProgress());
    expect(steps.map((s) => s.status)).toEqual(["current", "pending", "pending", "locked", "locked"]);
    expect(steps[3].clickable).toBe(false);
    expect(steps[4].clickable).toBe(false);
    expect(steps).toHaveLength(5);
  });

  it("아이디어를 고르면 1단계가 완료되고 2단계로 가며, 완료된 1단계는 누를 수 있다", () => {
    const p = chooseIdea(createProgress(), "아침 미세먼지 알림");
    const steps = stepViews(p);
    expect(p.view).toBe("direction");
    expect(steps[0]).toMatchObject({ status: "done", clickable: true });
    expect(steps[1]).toMatchObject({ status: "current", isCurrent: true });
  });

  it("방향을 확정하면 2단계가 완료되고 3단계로 간다", () => {
    let p = chooseIdea(createProgress(), "아침 미세먼지 알림");
    p = finishDirection(p);
    expect(p.view).toBe("spec");
    expect(stepViews(p).map((s) => s.status)).toEqual(["done", "done", "current", "locked", "locked"]);
  });

  it("Spec을 확정하면 3단계가 완료되고 완료 화면이 된다", () => {
    const p = throughSpecDone();
    expect(p.finished).toBe(true);
    expect(stepViews(p)[2].status).toBe("done");
  });
});

describe("아이디어 시작", () => {
  it("적은 아이디어가 프로젝트 이름이 되고, 재료 추천의 제목이 있으면 제목을 쓴다", () => {
    expect(chooseIdea(createProgress(), "아침 미세먼지 알림").projectName).toBe("아침 미세먼지 알림");
    const long = "매일 아침 7시에 내 동네 미세먼지가 나쁨이면 메신저로 알려 주는 서비스를 만들고 싶어요";
    expect(chooseIdea(createProgress(), long).projectName.length).toBeLessThanOrEqual(24);
    expect(chooseIdea(createProgress(), "매일 아침 7시, 내 동네 미세먼지가 나쁨이면 알려줘요.", "아침 미세먼지 알림").projectName).toBe("아침 미세먼지 알림");
  });

  it("처음 시작하는 프로젝트의 이름은 새 프로젝트다", () => {
    expect(createProgress().projectName).toBe("새 프로젝트");
  });
});

describe("대화와 문서", () => {
  it("사용자의 빈 메시지는 추가되지 않는다", () => {
    const p = chooseIdea(createProgress(), "a");
    expect(addUserMessage(p, "direction", "   ").direction.messages).toHaveLength(0);
    expect(addUserMessage(p, "direction", " 안녕 ").direction.messages).toEqual([{ role: "user", text: "안녕" }]);
  });

  it("agent 응답은 메시지를 더하고 문서의 해당 항목만 바꾸며 바뀐 항목을 강조 목록에 담는다", () => {
    let p = chooseIdea(createProgress(), "a");
    p = applyAgentReply(p, "direction", reply("좋아요", { oneLine: "한 줄", coreLoop: "" }));
    expect(p.direction.messages.at(-1)).toEqual({ role: "agent", text: "좋아요" });
    expect(p.direction.doc.oneLine).toBe("한 줄");
    expect(p.direction.doc.usersSituation).toBe("");
    expect(p.fresh).toEqual(["oneLine"]);
  });
});

describe("다시 확인 필요", () => {
  it("3단계 완료 뒤 2단계를 고치는 중에는 고치는 중 안내가 보인다", () => {
    const p = openStep(throughSpecDone(), 2);
    expect(p.view).toBe("direction");
    expect(showEditNotice(p)).toBe(true);
    expect(showEditNotice(chooseIdea(createProgress(), "a"))).toBe(false);
  });

  it("서비스 방향이 실제로 바뀌면 3단계는 내용을 유지한 채 다시 확인이 되고, 바뀐 내용이 기록된다", () => {
    let p = openStep(throughSpecDone(), 2);
    p = applyAgentReply(p, "direction", reply("바꿨어요", { promisedChange: "시간을 직접 고른다" }));
    expect(p.review[3]).toBe(true);
    expect(p.spec.doc.result).toBe("알림 한 통을 받는다");
    expect(p.spec.done).toBe(true);
    expect(p.changeNote).toContain("약속하는 변화");
    expect(p.changeNote).toContain("시간을 직접 고른다");
    expect(stepViews(p)[2].status).toBe("review");
  });

  it("서비스 방향 문서가 그대로면 다시 확인이 되지 않는다", () => {
    let p = openStep(throughSpecDone(), 2);
    p = applyAgentReply(p, "direction", reply("그대로예요", { promisedChange: "고민 없이 출근" }));
    expect(p.review[3]).toBe(false);
  });

  it("바뀐 부분 반영하기든 그대로 두기든 표시가 사라진다", () => {
    let p = openStep(throughSpecDone(), 2);
    p = applyAgentReply(p, "direction", reply("바꿨어요", { promisedChange: "다름" }));
    const resolved = resolveReview(p, 3);
    expect(resolved.review[3]).toBe(false);
    expect(resolved.changeNote).toBe("");
    expect(stepViews(resolved)[2].status).not.toBe("review");
  });

  it("아직 3단계를 시작하지 않았다면 2단계가 바뀌어도 다시 확인이 없다", () => {
    let p = chooseIdea(createProgress(), "a");
    p = applyAgentReply(p, "direction", reply("네", { oneLine: "x" }));
    p = applyAgentReply(p, "direction", reply("네", { oneLine: "y" }));
    expect(p.review).toEqual({ 2: false, 3: false, 4: false });
  });

  it("1단계 아이디어를 바꾸면 이미 진행한 2·3단계가 내용을 유지한 채 다시 확인이 된다", () => {
    const edited = chooseIdea(openStep(throughSpecDone(), 1), "주말 날씨 리포트");
    expect(edited.review).toEqual({ 2: true, 3: true, 4: false });
    expect(edited.direction.doc.oneLine).toBe("아침 알림");
    expect(edited.spec.doc.result).toBe("알림 한 통을 받는다");
    expect(edited.changeNote).toContain("주말 날씨 리포트");
  });

  it("같은 아이디어로 다시 시작하면 다시 확인이 되지 않는다", () => {
    const again = chooseIdea(openStep(throughSpecDone(), 1), "아침 미세먼지 알림");
    expect(again.review).toEqual({ 2: false, 3: false, 4: false });
  });

  it("다시 확인 상태의 단계는 다른 화면에 있을 때 누를 수 있다", () => {
    let p = openStep(throughSpecDone(), 2);
    p = applyAgentReply(p, "direction", reply("바꿨어요", { promisedChange: "다름" }));
    expect(stepViews(p)[2]).toMatchObject({ status: "review", clickable: true });
  });
});

describe("지금 할 일", () => {
  it("현재 단계마다 사용자가 할 행동을 한 문장으로 보여 준다", () => {
    const find = nextAction(createProgress());
    const direction = nextAction(chooseIdea(createProgress(), "a"));
    const spec = nextAction(finishDirection(chooseIdea(createProgress(), "a")));
    expect(new Set([find, direction, spec]).size).toBe(3);
    for (const t of [find, direction, spec]) expect(t.length).toBeGreaterThan(5);
  });
});

describe("4·5단계(구현과 배포)", () => {
  const withRepo = (p: ReturnType<typeof throughSpecDone>) => ({
    ...p,
    delivery: { ...p.delivery, repoUrl: "https://github.com/u/r", done: ["generate", "repo", "push"] as ("generate" | "repo" | "push")[] },
  });

  it("3단계를 확정하기 전에는 4·5단계가 잠겨 있고 누를 수 없다", () => {
    const steps = stepViews(chooseIdea(createProgress(), "a"));
    expect(steps[3]).toMatchObject({ status: "locked", clickable: false });
    expect(steps[4]).toMatchObject({ status: "locked", clickable: false });
    expect(openStep(chooseIdea(createProgress(), "a"), 4).view).toBe("direction");
  });

  it("3단계를 확정하면 4·5단계가 풀려 눌러서 들어갈 수 있다", () => {
    const p = throughSpecDone();
    const steps = stepViews(p);
    expect(steps[3]).toMatchObject({ status: "pending", clickable: true });
    expect(steps[4]).toMatchObject({ status: "pending", clickable: true });
    expect(openStep(p, 4).view).toBe("delivery");
    expect(openStep(p, 5).view).toBe("delivery");
  });

  it("저장소를 올리면 4단계가 완료되고, 배포 주소가 확인되면 5단계도 완료된다", () => {
    const p = withRepo(throughSpecDone());
    const afterRepo = stepViews(p);
    expect(afterRepo[3].status).toBe("done");
    expect(afterRepo[4].status).not.toBe("done");
    const deployed = { ...p, delivery: { ...p.delivery, deployUrl: "https://x.vercel.app", verified: true } };
    expect(stepViews(deployed)[4].status).toBe("done");
  });

  it("구현 화면에서는 현재 단계가 4단계이고 저장소를 올린 뒤에는 5단계다", () => {
    const base = openStep(throughSpecDone(), 4);
    expect(stepViews(base)[3].isCurrent).toBe(true);
    expect(stepViews(withRepo(base))[4].isCurrent).toBe(true);
  });

  it("구현을 마친 뒤 서비스 방향이 바뀌면 4·5단계가 내용을 유지한 채 다시 확인이 된다", () => {
    let p = openStep(withRepo(throughSpecDone()), 2);
    p = applyAgentReply(p, "direction", reply("바꿨어요", { promisedChange: "새 약속" }));
    expect(p.review[4]).toBe(true);
    expect(p.delivery.repoUrl).toBe("https://github.com/u/r");
    const steps = stepViews(p);
    expect(steps[3].status).toBe("review");
    expect(steps[4].status).toBe("review");
  });

  it("구현을 마친 뒤 첫 Spec이나 아이디어가 바뀌어도 4·5단계가 다시 확인이 된다", () => {
    const specEdited = applyAgentReply(openStep(withRepo(throughSpecDone()), 3), "spec", reply("고쳤어요", { result: "다른 결과" }));
    expect(specEdited.review[4]).toBe(true);
    const ideaEdited = chooseIdea(openStep(withRepo(throughSpecDone()), 1), "주말 날씨 리포트");
    expect(ideaEdited.review[4]).toBe(true);
  });

  it("아직 구현하지 않았다면 앞 단계가 바뀌어도 4·5단계는 다시 확인이 되지 않는다", () => {
    const p = applyAgentReply(openStep(throughSpecDone(), 2), "direction", reply("바꿨어요", { promisedChange: "새 약속" }));
    expect(p.review[4]).toBe(false);
  });

  it("다시 확인 표시는 해결하면 사라진다", () => {
    let p = openStep(withRepo(throughSpecDone()), 2);
    p = applyAgentReply(p, "direction", reply("바꿨어요", { promisedChange: "새 약속" }));
    expect(resolveReview(p, 4).review[4]).toBe(false);
  });

  it("구현 화면의 지금 할 일은 상태마다 다르다", () => {
    const start = nextAction(openStep(throughSpecDone(), 4));
    const done = nextAction(openStep({ ...withRepo(throughSpecDone()), delivery: { ...throughSpecDone().delivery, deployUrl: "https://x", verified: true } }, 5));
    expect(start).not.toBe(done);
    expect(start.length).toBeGreaterThan(5);
  });
});
