"use client";

import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { callAgent } from "../client";
import type { Connection } from "../types";

export function StartScreen({
  initial,
  onConnected,
  onCancel,
}: {
  initial: Connection | null;
  onConnected: (c: Connection) => void;
  onCancel?: () => void;
}) {
  const [apiKey, setApiKey] = useState(initial?.apiKey ?? "");
  const [endpoint, setEndpoint] = useState(initial?.endpoint ?? "");
  const [deployment, setDeployment] = useState(initial?.deployment ?? "");
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [help, setHelp] = useState(false);

  async function start() {
    const connection = { apiKey: apiKey.trim(), endpoint: endpoint.trim(), deployment: deployment.trim() };
    if (!connection.apiKey || !connection.endpoint || !connection.deployment) {
      setFailed("키, 엔드포인트 주소, 배포 이름을 모두 적어 주세요.");
      return;
    }
    setChecking(true);
    setFailed(null);
    const res = await callAgent({ kind: "verify", connection });
    setChecking(false);
    if (res.ok) onConnected(connection);
    else setFailed(res.message);
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">만들고 싶은 시스템, 처음부터 같이 정리해요</CardTitle>
          <CardDescription>
            아이디어 찾기부터 서비스 방향, 먼저 만들 결과(Spec)까지 순서대로 안내해 드려요. 시작하려면 본인의 Azure OpenAI 키, 엔드포인트, 배포 이름이 필요해요.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {failed && (
            <Alert variant="destructive">
              <AlertTitle>키를 확인하지 못했어요</AlertTitle>
              <AlertDescription>{failed}</AlertDescription>
            </Alert>
          )}
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void start();
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="apiKey">Azure OpenAI API 키</FieldLabel>
                <Input
                  id="apiKey"
                  type="password"
                  autoComplete="off"
                  placeholder="Azure 포털에서 복사한 키"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  aria-invalid={!!failed && !apiKey.trim()}
                />
                <FieldDescription>키는 이 브라우저에만 저장되고, 서비스 서버에는 보관하지 않아요.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="endpoint">엔드포인트 주소</FieldLabel>
                <Input
                  id="endpoint"
                  type="text"
                  autoComplete="off"
                  placeholder="https://내리소스.openai.azure.com"
                  value={endpoint}
                  onChange={(e) => setEndpoint(e.target.value)}
                  aria-invalid={!!failed && !endpoint.trim()}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="deployment">배포 이름</FieldLabel>
                <Input
                  id="deployment"
                  type="text"
                  autoComplete="off"
                  placeholder="예) gpt-4o"
                  value={deployment}
                  onChange={(e) => setDeployment(e.target.value)}
                  aria-invalid={!!failed && !deployment.trim()}
                />
              </Field>
            </FieldGroup>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" disabled={checking}>
                {checking ? "확인하는 중…" : "시작하기"}
              </Button>
              {onCancel && (
                <Button type="button" variant="outline" onClick={onCancel}>
                  돌아가기
                </Button>
              )}
              <Button type="button" variant="link" onClick={() => setHelp((v) => !v)}>
                키는 어디서 받나요?
              </Button>
            </div>
          </form>
          {help && (
            <div className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              Azure 포털에서 Azure OpenAI 리소스를 열고 &apos;키 및 엔드포인트&apos; 메뉴에서 키와 엔드포인트 주소를 복사하세요. 배포 이름은 같은 리소스의 모델 배포 목록에서 확인할 수 있어요.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
