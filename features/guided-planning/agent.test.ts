import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAgentRequest, parseAgentReply, parseIdeas } from "./agent";

const connection = { apiKey: "SECRET-KEY-123", endpoint: "https://my-res.openai.azure.com/", deployment: "my-deploy" };

function azure(content: string, status = 200) {
  return vi.fn(async () =>
    new Response(status === 200 ? JSON.stringify({ choices: [{ message: { content } }] }) : "{}", { status }),
  );
}
function sentBody(fetchMock: ReturnType<typeof azure>) {
  const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
  return JSON.parse(String(init.body)) as { messages: { role: string; content: string }[] };
}

afterEach(() => vi.restoreAllMocks());

describe("키 확인", () => {
  it("입력한 키, 엔드포인트, 배포 이름으로 Azure OpenAI 배포를 호출하고 성공하면 ok를 돌려준다", async () => {
    const f = azure('{"ok":true}');
    const res = await handleAgentRequest({ kind: "verify", connection }, f);
    expect(res).toEqual({ ok: true, kind: "verify" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^https:\/\/my-res\.openai\.azure\.com\/openai\/deployments\/my-deploy\/chat\/completions\?api-version=/);
    expect((init.headers as Record<string, string>)["api-key"]).toBe("SECRET-KEY-123");
  });

  it.each([401, 403, 404, 429])("Azure가 %i로 거부하면 키 문제로 알린다", async (status) => {
    const res = await handleAgentRequest({ kind: "verify", connection }, azure("", status));
    expect(res).toMatchObject({ ok: false, code: "key" });
  });

  it("세 입력 중 하나라도 비었거나 엔드포인트가 https가 아니면 호출하지 않고 키 문제로 알린다", async () => {
    const f = azure("{}");
    for (const bad of [
      { ...connection, apiKey: " " },
      { ...connection, endpoint: "" },
      { ...connection, endpoint: "http://x.com" },
      { ...connection, deployment: "" },
    ]) {
      expect(await handleAgentRequest({ kind: "verify", connection: bad }, f)).toMatchObject({ ok: false, code: "key" });
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("서버 오류나 네트워크 오류는 키 문제가 아닌 실패로 알린다", async () => {
    expect(await handleAgentRequest({ kind: "verify", connection }, azure("", 500))).toMatchObject({ ok: false, code: "failed" });
    const boom = vi.fn(async () => {
      throw new Error("network");
    });
    expect(await handleAgentRequest({ kind: "verify", connection }, boom)).toMatchObject({ ok: false, code: "failed" });
  });

  it("키를 응답에 되돌려주지 않고 서버 로그에도 남기지 않는다", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const results = [
      await handleAgentRequest({ kind: "verify", connection }, azure("{}")),
      await handleAgentRequest({ kind: "verify", connection }, azure("", 401)),
      await handleAgentRequest({ kind: "verify", connection }, azure("", 500)),
    ];
    expect(JSON.stringify(results)).not.toContain("SECRET-KEY-123");
    for (const s of spies) expect(JSON.stringify(s.mock.calls)).not.toContain("SECRET-KEY-123");
  });
});

describe("아이디어 추천", () => {
  const ideasJson = JSON.stringify({
    ideas: [
      { title: "아침 미세먼지 알림", summary: "매일 아침 알려줘요." },
      { title: "주말 날씨 리포트", summary: "금요일에 메일로 보내줘요." },
      { title: "마스크 챙김 체크", summary: "출근 전에 한 줄로 알려줘요." },
    ],
  });

  it("고른 재료를 프롬프트에 담아 제목과 한 줄 설명이 있는 아이디어 3개를 돌려준다", async () => {
    const f = azure(ideasJson);
    const res = await handleAgentRequest({ kind: "ideas", connection, materials: ["날씨와 미세먼지", "환율"] }, f);
    expect(res).toMatchObject({ ok: true, kind: "ideas" });
    if (res.ok && res.kind === "ideas") expect(res.ideas).toHaveLength(3);
    const text = sentBody(f).messages.map((m) => m.content).join("\n");
    expect(text).toContain("날씨와 미세먼지");
    expect(text).toContain("환율");
  });

  it("다시 받을 때는 이미 나온 아이디어 제목을 피하도록 요청한다", async () => {
    const f = azure(ideasJson);
    await handleAgentRequest({ kind: "ideas", connection, materials: ["환율"], avoid: ["아침 미세먼지 알림"] }, f);
    expect(sentBody(f).messages.map((m) => m.content).join("\n")).toContain("아침 미세먼지 알림");
  });

  const idea = (title: string, summary: string) => ({ title, summary });
  const sequence = (...bodies: unknown[]) => {
    let i = 0;
    return vi.fn(async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]) } }] }), { status: 200 }),
    );
  };

  it("고르지 않은 재료가 있어야 하는 아이디어가 나오면 이유를 알려 주고 다시 요청해, 고쳐진 3개를 돌려준다", async () => {
    const bad = { ideas: [idea("A", "날씨를 보여줘요."), idea("B", "메일로 보내줘요."), idea("C", "취향에 맞게 추천해요.")] };
    const good = { ideas: [idea("A", "날씨를 보여줘요."), idea("B", "환율을 보여줘요."), idea("C", "미세먼지를 보여줘요.")] };
    const f = sequence(bad, good);
    const res = await handleAgentRequest({ kind: "ideas", connection, materials: ["날씨와 미세먼지", "환율"] }, f);
    expect(f).toHaveBeenCalledTimes(2);
    expect(res).toMatchObject({ ok: true, kind: "ideas" });
    if (res.ok && res.kind === "ideas") expect(res.ideas.map((i) => i.title)).toEqual(["A", "B", "C"]);
    const retryText = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).messages.map((m: { content: string }) => m.content).join("\n");
    expect(retryText).toContain("메일");
    expect(retryText).toContain("추천");
  });

  it("알림 기능은 없어서, 알림이나 메일로 보내는 아이디어가 나오면 화면에서 보는 서비스로 바꿔 달라고 다시 요청한다", async () => {
    const bad = { ideas: [idea("A", "미세먼지가 나쁘면 알려줘요."), idea("B", "환율을 보여줘요."), idea("C", "날씨를 보여줘요.")] };
    const good = { ideas: [idea("A", "미세먼지를 보여줘요."), idea("B", "환율을 보여줘요."), idea("C", "날씨를 보여줘요.")] };
    const f = sequence(bad, good);
    await handleAgentRequest({ kind: "ideas", connection, materials: ["날씨와 미세먼지", "환율"] }, f);
    expect(f).toHaveBeenCalledTimes(2);
    const retryText = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).messages.map((m: { content: string }) => m.content).join("\n");
    expect(retryText).toContain("알림");
  });

  it("두 번 고쳐 달라고 해도 어긋나면 사용자를 막지 않고 마지막 결과를 돌려준다", async () => {
    const bad = { ideas: [idea("A", "메일로 보내줘요."), idea("B", "날씨를 보여줘요."), idea("C", "날씨를 보여줘요 2.")] };
    const f = sequence(bad);
    const res = await handleAgentRequest({ kind: "ideas", connection, materials: ["날씨와 미세먼지"] }, f);
    expect(f).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ ok: true, kind: "ideas" });
  });

  it("재료 목록에 없는 데이터(인기 순위, 리뷰, 평점)가 필요한 아이디어도 다시 요청한다", async () => {
    const bad = { ideas: [idea("A", "인기 대여소 순위를 보여줘요."), idea("B", "리뷰와 평점을 모아 보여줘요."), idea("C", "대여소를 보여줘요.")] };
    const good = { ideas: [idea("A", "대여소를 보여줘요."), idea("B", "대여소 위치를 보여줘요."), idea("C", "대여 가능 수를 보여줘요.")] };
    const f = sequence(bad, good);
    await handleAgentRequest({ kind: "ideas", connection, materials: ["따릉이 대여소"] }, f);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("고른 재료로 설명되는 아이디어는 다시 요청하지 않는다", async () => {
    const f = sequence({ ideas: [idea("A", "날씨를 보여줘요."), idea("B", "미세먼지를 보여줘요."), idea("C", "날씨와 미세먼지를 비교해요.")] });
    await handleAgentRequest({ kind: "ideas", connection, materials: ["날씨와 미세먼지"] }, f);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("재료가 하나도 없으면 호출하지 않는다", async () => {
    const f = azure(ideasJson);
    expect(await handleAgentRequest({ kind: "ideas", connection, materials: [] }, f)).toMatchObject({ ok: false, code: "invalid" });
    expect(f).not.toHaveBeenCalled();
  });

  it("아이디어가 3개가 아니거나 형식이 깨지면 실패로 알린다", async () => {
    expect(parseIdeas(ideasJson)).toHaveLength(3);
    expect(() => parseIdeas('{"ideas":[{"title":"a","summary":"b"}]}')).toThrow();
    expect(() => parseIdeas("그냥 글")).toThrow();
    const res = await handleAgentRequest({ kind: "ideas", connection, materials: ["환율"] }, azure("그냥 글"));
    expect(res).toMatchObject({ ok: false, code: "failed" });
  });
});

describe("대화", () => {
  const chatBase = {
    kind: "chat" as const,
    connection,
    stage: "direction" as const,
    projectName: "아침 미세먼지 알림",
    idea: "아침 미세먼지 알림",
    doc: { oneLine: "", usersSituation: "", problemAlternatives: "", promisedChange: "", coreLoop: "" },
    messages: [],
  };
  const reply = JSON.stringify({ message: "누가 받나요?", doc: { oneLine: "아침 알림", 모르는항목: "x" } });

  it("agent의 답과 바뀐 문서 항목을 돌려주고, 모르는 항목은 버린다", async () => {
    const res = await handleAgentRequest(chatBase, azure(reply));
    expect(res).toEqual({ ok: true, kind: "chat", reply: { message: "누가 받나요?", doc: { oneLine: "아침 알림" } } });
  });

  it("대화가 비어 있으면 아이디어를 반영한 첫 질문을 하도록 시작 요청을 보낸다", async () => {
    const f = azure(reply);
    await handleAgentRequest(chatBase, f);
    const msgs = sentBody(f).messages;
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("아침 미세먼지 알림");
    expect(msgs.at(-1)?.role).toBe("user");
  });

  it("사용자의 메시지와 이전 대화를 순서대로 보내고, 현재 문서를 시스템 지침에 담는다", async () => {
    const f = azure(reply);
    await handleAgentRequest(
      {
        ...chatBase,
        doc: { ...chatBase.doc, oneLine: "이미 채워진 한 줄" },
        messages: [
          { role: "agent", text: "누가 받나요?" },
          { role: "user", text: "직장인이요" },
        ],
      },
      f,
    );
    const msgs = sentBody(f).messages;
    expect(msgs[0].content).toContain("이미 채워진 한 줄");
    expect(msgs.slice(1).map((m) => [m.role, m.content])).toEqual([
      ["assistant", "누가 받나요?"],
      ["user", "직장인이요"],
    ]);
  });

  it("3단계 대화에는 확정된 서비스 방향 문서가 함께 전달된다", async () => {
    const f = azure(JSON.stringify({ message: "이 결과로 갈까요?", doc: { result: "알림 한 통" } }));
    const direction = { ...chatBase.doc, oneLine: "방향 한 줄 정의" };
    const res = await handleAgentRequest(
      { ...chatBase, stage: "spec", doc: { result: "", scope: [], verification: [], notNow: "" }, direction },
      f,
    );
    expect(res).toMatchObject({ ok: true, reply: { doc: { result: "알림 한 통" } } });
    expect(sentBody(f).messages[0].content).toContain("방향 한 줄 정의");
  });

  describe("3단계 Spec 검사", () => {
    const specBase = {
      ...chatBase,
      stage: "spec" as const,
      doc: { result: "", scope: [], verification: [], notNow: "" },
      direction: chatBase.doc,
    };
    const replyOf = (doc: object) => ({ message: "제안해요. 이대로 갈까요?", doc });
    const seq = (...bodies: unknown[]) => {
      let i = 0;
      return vi.fn(async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(bodies[Math.min(i++, bodies.length - 1)]) } }] }), { status: 200 }),
      );
    };
    const good = { result: "동네를 고르면 내일 아침 알림이 온다", scope: ["동네 한 곳을 고른다", "아침에 알림 한 통이 온다"], verification: ["동네를 고르고 다음 날 아침에 알림이 오는지 본다"], notNow: "여러 동네" };

    it("범위에 데이터 수집 같은 작업 이름이 있으면 이유를 알려 주고 다시 받는다", async () => {
      const f = seq(replyOf({ ...good, scope: ["데이터 수집", "디자인"] }), replyOf(good));
      const res = await handleAgentRequest(specBase, f);
      expect(f).toHaveBeenCalledTimes(2);
      expect(res).toMatchObject({ ok: true, reply: { doc: { scope: good.scope } } });
      const retry = JSON.parse(String((f.mock.calls[1] as unknown as [string, RequestInit])[1].body)).messages.at(-1).content as string;
      expect(retry).toContain("데이터 수집");
    });

    it("범위가 5개 이상이거나 확인 방법이 막연하면 다시 받는다", async () => {
      const tooMany = replyOf({ ...good, scope: ["가", "나", "다", "라", "마"].map((x) => `${x}를 본다`) });
      const vague = replyOf({ ...good, verification: ["정확한지 확인하기"] });
      for (const bad of [tooMany, vague]) {
        const f = seq(bad, replyOf(good));
        await handleAgentRequest(specBase, f);
        expect(f).toHaveBeenCalledTimes(2);
      }
    });

    it.each(["기록이 잘 되었는지 다시 확인한다", "올바른 통화의 환율이 반영되는지 확인한다", "받은 정보와 기상청의 수치를 비교한다", "이메일 내용이 요약이 잘 되었는지 본다"])(
      "막연하거나 정확성을 따지는 확인 방법(%s)은 다시 받는다",
      async (vagueItem) => {
        const f = seq(replyOf({ ...good, verification: [good.verification[0], vagueItem] }), replyOf(good));
        await handleAgentRequest(specBase, f);
        expect(f).toHaveBeenCalledTimes(2);
      },
    );

    it("확인 방법이 범위에 없는 기능(알림 전송, 다른 사람)을 확인하라고 하면 다시 받는다", async () => {
      const inScope = { ...good, result: "동네를 고르면 화면에 동네 이름이 보인다", scope: ["동네 한 곳을 고른다", "고른 동네를 본다"], verification: ["동네를 고르면 동네 이름이 화면에 보인다"] };
      for (const outside of ["선택한 일정이 그룹원들에게 알림으로 전송되는지 확인한다", "다른 사람들의 일정을 확인할 수 있는지 본다"]) {
        const f = seq(replyOf({ ...inScope, verification: [inScope.verification[0], outside] }), replyOf(inScope));
        await handleAgentRequest(specBase, f);
        expect(f).toHaveBeenCalledTimes(2);
      }
    });

    it("범위에 없는 일(요약, 추천, 기록, 검색 등)을 확인하라고 하면 다시 받는다", async () => {
      const inScope = { ...good, result: "동네를 고르면 화면에 동네 이름이 보인다", scope: ["동네 한 곳을 고른다", "고른 동네를 본다"], verification: ["동네를 고르면 동네 이름이 화면에 보인다"] };
      for (const outside of ["동네를 고르면 한 줄 요약이 화면에 보인다", "동네를 고르면 추천 목록이 화면에 보인다", "동네를 고르면 이전 기록이 화면에 보인다", "동네를 검색하면 결과가 화면에 보인다"]) {
        const f = seq(replyOf({ ...inScope, verification: [outside] }), replyOf(inScope));
        await handleAgentRequest(specBase, f);
        expect(f).toHaveBeenCalledTimes(2);
      }
    });

    it("범위나 결과에 알림이 들어 있으면 알림을 확인하는 방법은 허용한다", async () => {
      const f = seq(replyOf({ ...good, verification: ["동네를 고르고 다음 날 아침에 알림이 오는지 본다"] }));
      await handleAgentRequest(specBase, f);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it("확인 방법이 2개 이상이거나 화면에서 볼 것이 적혀 있지 않으면 다시 받는다", async () => {
      const three = replyOf({ ...good, verification: [good.verification[0], "동네 이름이 화면에 보인다"] });
      const unseen = replyOf({ ...good, verification: ["내용을 살펴본다"] });
      for (const bad of [three, unseen]) {
        const f = seq(bad, replyOf(good));
        await handleAgentRequest(specBase, f);
        expect(f).toHaveBeenCalledTimes(2);
      }
    });

    it("결과에 서로 다른 일이 이어 붙어 있으면(하고, 그리고, 및) 하나로 줄여 다시 받는다", async () => {
      for (const result of ["운동 내용을 기록하고 칭찬 메시지를 받는다", "영화를 기록하며 추천 영화를 받는다 그리고 알림이 온다"]) {
        const f = seq(replyOf({ ...good, result }), replyOf(good));
        await handleAgentRequest(specBase, f);
        expect(f).toHaveBeenCalledTimes(2);
      }
    });

    it("화면에서 무엇을 보면 되는지 적힌 구체적인 확인 방법은 다시 받지 않는다", async () => {
      const f = seq(replyOf({ ...good, verification: ["아침 7시에 메신저로 미세먼지 정보를 받는다"] }));
      await handleAgentRequest(specBase, f);
      expect(f).toHaveBeenCalledTimes(1);
    });

    it("바뀐 방향 반영 요청인데 Spec이 하나도 바뀌지 않으면 다시 받는다", async () => {
      const f = seq({ message: "반영했어요", doc: {} }, replyOf(good));
      const res = await handleAgentRequest({ ...specBase, doc: good, messages: [{ role: "agent", text: "옛 질문" }], reflect: "약속하는 변화: 시간을 직접 고른다" }, f);
      expect(f).toHaveBeenCalledTimes(2);
      expect(res).toMatchObject({ ok: true, reply: { doc: { result: good.result } } });
    });

    it("Spec의 네 항목 중 비어 있는 것이 있으면 채워서 다시 받는다", async () => {
      const f = seq(replyOf({ result: good.result, scope: good.scope, notNow: good.notNow }), replyOf(good));
      const res = await handleAgentRequest(specBase, f);
      expect(f).toHaveBeenCalledTimes(2);
      expect(res).toMatchObject({ ok: true, reply: { doc: { verification: good.verification } } });
    });

    it("규칙을 지킨 Spec은 다시 받지 않고, 계속 어긋나도 두 번까지만 다시 받는다", async () => {
      const fine = seq(replyOf(good));
      await handleAgentRequest(specBase, fine);
      expect(fine).toHaveBeenCalledTimes(1);
      const stubborn = seq(replyOf({ ...good, scope: ["데이터 수집"] }));
      const res = await handleAgentRequest(specBase, stubborn);
      expect(stubborn).toHaveBeenCalledTimes(3);
      expect(res).toMatchObject({ ok: true });
    });
  });

  it("바뀐 방향 반영 요청에는 바뀐 내용을 함께 보낸다", async () => {
    const f = azure(JSON.stringify({ message: "고쳤어요", doc: { result: "새 결과" } }));
    await handleAgentRequest(
      {
        ...chatBase,
        stage: "spec",
        doc: { result: "옛 결과", scope: [], verification: [], notNow: "" },
        direction: chatBase.doc,
        messages: [{ role: "agent", text: "옛 질문" }],
        reflect: "약속하는 변화: 시간을 직접 고른다",
      },
      f,
    );
    expect(sentBody(f).messages.at(-1)?.content).toContain("시간을 직접 고른다");
  });

  it("키가 거부되면 키 문제로, 그 밖의 실패는 실패로 알린다", async () => {
    expect(await handleAgentRequest(chatBase, azure("", 401))).toMatchObject({ ok: false, code: "key" });
    expect(await handleAgentRequest(chatBase, azure("", 500))).toMatchObject({ ok: false, code: "failed" });
    expect(await handleAgentRequest(chatBase, azure("JSON 아님"))).toMatchObject({ ok: false, code: "failed" });
  });

  it("알 수 없는 요청 종류나 단계는 invalid로 알린다", async () => {
    expect(await handleAgentRequest({ kind: "nope", connection }, azure("{}"))).toMatchObject({ ok: false, code: "invalid" });
    expect(await handleAgentRequest({ ...chatBase, stage: "x" }, azure("{}"))).toMatchObject({ ok: false, code: "invalid" });
  });
});

describe("agent 응답 해석", () => {
  it("코드 블록으로 감싼 JSON도 읽고, 목록 항목은 문자열 배열로 정리한다", () => {
    const parsed = parseAgentReply(
      "spec",
      '```json\n{"message":"네","doc":{"scope":["a"," b ",""],"result":"r","notNow":5}}\n```',
    );
    expect(parsed).toEqual({ message: "네", doc: { scope: ["a", "b"], result: "r" } });
  });

  it("message가 없거나 비어 있으면 오류다", () => {
    expect(() => parseAgentReply("direction", '{"doc":{}}')).toThrow();
    expect(() => parseAgentReply("direction", '{"message":"  ","doc":{}}')).toThrow();
  });
});
