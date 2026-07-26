"use client";

import React, { useState, type FormEvent } from "react";

import type {
  CorroborationReport,
  DiscardedCandidate,
  TargetStackFact,
} from "@/types/authoring";
import type { Pattern } from "@/types/pattern";

type Requester = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export type DraftedResponse = {
  status: "drafted";
  draftId: string;
  pattern: Pattern;
  corroboration: CorroborationReport;
  targetStackFacts: TargetStackFact[];
  discarded: DiscardedCandidate[];
  selfVerify:
    | { status: "passed"; frozenArgv: string[] }
    | { status: "skipped"; reason: "descriptive" }
    | { status: "failed"; detail: string };
  proposer: { providerId: string; modelId: string };
};

type ErrorResponse = { status: string; detail: string };
type RegistrationResult =
  | { status: "registered"; path: string }
  | ErrorResponse;
type SourceInput = {
  repository: string;
  stack: string;
  isTargetStack: "" | "true" | "false";
  independenceGroup: string;
  independenceNote: string;
};

const emptySource = (): SourceInput => ({
  repository: "",
  stack: "",
  isTargetStack: "",
  independenceGroup: "",
  independenceNote: "",
});

async function postJson(
  url: string,
  body: unknown,
  request: Requester = fetch,
): Promise<unknown> {
  const response = await request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

export async function approveAndRegisterDraft(
  draftId: string,
  request: Requester = fetch,
): Promise<RegistrationResult> {
  const approved = (await postJson(
    `/api/authoring/drafts/${draftId}/approve`,
    {},
    request,
  )) as { status: string; detail?: string };
  if (approved.status !== "approved") {
    return {
      status: approved.status,
      detail: approved.detail ?? "초안 승인이 거부되었습니다.",
    };
  }
  return (await postJson(
    `/api/authoring/drafts/${draftId}/register`,
    {},
    request,
  )) as RegistrationResult;
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border border-neutral-800 bg-[#141414] p-5">
      <h3 className="text-sm font-medium text-neutral-400">{title}</h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function SelfVerifyView({
  result,
}: {
  result: DraftedResponse["selfVerify"];
}) {
  if (result.status === "passed") {
    return (
      <div className="border-l-2 border-green-500 pl-3 text-sm text-green-400">
        <p>양성 green과 음성 red가 확인되었습니다.</p>
        <p className="mt-2 font-mono text-xs text-neutral-400">
          {result.frozenArgv.join(" · ")}
        </p>
      </div>
    );
  }
  if (result.status === "skipped") {
    return (
      <p className="text-sm text-neutral-400">
        descriptive 패턴이므로 자기검증을 건너뛰었습니다.
      </p>
    );
  }
  return (
    <div className="border-l-2 border-red-500 pl-3 text-sm text-red-400">
      <p>자기검증에 실패해 승인과 등재가 차단되었습니다.</p>
      <p className="mt-1">{result.detail}</p>
    </div>
  );
}

export function DraftReview({
  draft,
  approved,
  approving = false,
  onApprove,
  onReject,
}: {
  draft: DraftedResponse;
  approved: boolean;
  approving?: boolean;
  onApprove: () => void;
  onReject?: () => void;
}) {
  const canApprove = draft.selfVerify.status !== "failed";
  return (
    <div className="space-y-4" aria-label="저작 초안 검토">
      <Section title="Roles">
        <ul className="space-y-2 text-sm text-neutral-300">
          {draft.pattern.roles.map((role) => (
            <li key={role.id}>
              <span className="font-mono text-xs text-white">{role.id}</span>
              <span className="ml-2">{role.description}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Binding points">
        <ul className="space-y-2 text-sm text-neutral-300">
          {draft.pattern.bindingPoints.map((binding) => (
            <li key={binding.id}>
              <span className="font-mono text-xs text-white">{binding.id}</span>
              <span className="ml-2">{binding.description}</span>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Provenance">
        <ul className="space-y-2 font-mono text-xs text-neutral-400">
          {draft.pattern.provenance.map((item, index) => (
            <li key={`${item.sourceId}:${item.path}:${index}`}>
              {item.sourceId} · {item.path} · {item.observedRole}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Corroboration calculation">
        <p className="text-sm text-neutral-400">
          이 값은 당신이 입력한 independenceGroup을 센 결과이며 판정이 아닙니다.
        </p>
        <ul className="mt-3 space-y-2 text-sm text-neutral-300">
          {draft.corroboration.perRole.map((role) => (
            <li key={role.roleId}>
              <span className="font-mono text-xs">{role.roleId}</span>
              {" · "}
              {role.independenceGroups.join(", ")}
              {" · distinct "}
              {role.independenceGroups.length}
            </li>
          ))}
        </ul>
      </Section>
      <Section title={`강등된 role · ${draft.corroboration.demoted.length}`}>
        {draft.corroboration.demoted.length === 0 ? (
          <p className="text-sm text-neutral-500">강등된 role이 없습니다.</p>
        ) : (
          <ul className="space-y-2 text-sm text-neutral-300">
            {draft.corroboration.demoted.map((item) => (
              <li key={item.roleId}>
                <span className="font-mono text-xs">{item.roleId}</span>
                {" · "}
                {item.reason}
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={`버려진 후보 · ${draft.discarded.length}`}>
        {draft.discarded.length === 0 ? (
          <p className="text-sm text-neutral-500">버려진 후보가 없습니다.</p>
        ) : (
          <ul className="space-y-3">
            {draft.discarded.map((item, index) => (
              <li key={`${item.sourceId}:${item.path}:${index}`}>
                <p className="font-mono text-xs text-neutral-300">
                  {item.sourceId} · {item.path}
                </p>
                <p className="text-sm text-red-400">{item.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Target stack 관찰 사실">
        <p className="mb-3 text-sm text-neutral-400">
          아래는 관찰 결과이며 타깃 스택 판정이 아닙니다.
        </p>
        <ul className="space-y-3 text-sm text-neutral-300">
          {draft.targetStackFacts.map((fact) => (
            <li key={fact.sourceId}>
              <p>
                <span className="font-mono text-xs">{fact.sourceId}</span>
                {" · "}
                {fact.vitestObserved
                  ? "vitest가 관찰됨"
                  : "vitest가 관찰되지 않음"}
              </p>
              <p className="font-mono text-xs text-neutral-400">
                {fact.evidencePaths.join(", ") || "근거 경로 없음"}
              </p>
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Oracle 자기검증">
        <SelfVerifyView result={draft.selfVerify} />
      </Section>
      <Section title="Tradeoffs">
        <p className="text-sm leading-relaxed text-neutral-300">
          {draft.pattern.tradeoffs}
        </p>
      </Section>
      <div className="flex gap-4">
        <button
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          disabled={!canApprove || approving || approved}
          onClick={onApprove}
          type="button"
        >
          {approved ? "서버 승인 완료" : approving ? "승인 중…" : "초안 승인"}
        </button>
        {onReject && !approved && (
          <button
            className="text-sm text-neutral-500 hover:text-neutral-300"
            onClick={onReject}
            type="button"
          >
            초안 거부
          </button>
        )}
      </div>
    </div>
  );
}

export function RegistrationResultView({
  result,
}: {
  result: RegistrationResult;
}) {
  if ("path" in result) {
    return (
      <div className="border-l-2 border-green-500 pl-3 text-sm text-green-400">
        <p>카탈로그에 등재되었습니다.</p>
        <p className="mt-1 font-mono text-xs text-neutral-300">{result.path}</p>
      </div>
    );
  }
  const patternExists = result.detail.includes("pattern-exists");
  return (
    <div className="border-l-2 border-red-500 pl-3 text-sm text-red-400">
      <p>{result.status}</p>
      <p className="mt-1">{result.detail}</p>
      {patternExists && <p className="mt-1">기존 패턴은 변경되지 않았습니다.</p>}
    </div>
  );
}

export function RegistrationButton({
  approved,
  busy,
  onRegister,
}: {
  approved: boolean;
  busy: boolean;
  onRegister: () => void;
}) {
  return (
    <button
      className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
      disabled={!approved || busy}
      onClick={onRegister}
      type="button"
    >
      카탈로그 등재
    </button>
  );
}

function TextInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-neutral-300">
      {label}
      <input
        className="mt-1 block w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
        onChange={(event) => onChange(event.target.value)}
        required
        value={value}
      />
    </label>
  );
}

export default function AuthoringWizard() {
  const [patternId, setPatternId] = useState("");
  const [name, setName] = useState("");
  const [intent, setIntent] = useState("");
  const [capability, setCapability] =
    useState<Pattern["capability"]>("descriptive");
  const [evidenceStatus, setEvidenceStatus] =
    useState<Pattern["evidenceStatus"]>("observed");
  const [sources, setSources] = useState<SourceInput[]>([emptySource()]);
  const [draft, setDraft] = useState<DraftedResponse | null>(null);
  const [error, setError] = useState<ErrorResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [approved, setApproved] = useState(false);
  const [registration, setRegistration] =
    useState<RegistrationResult | null>(null);
  const corroboratedNeedsSources =
    evidenceStatus === "corroborated" && sources.length < 2;
  const sourceIncomplete = sources.some(
    (source) =>
      !source.repository.trim() ||
      !source.stack.trim() ||
      source.isTargetStack === "" ||
      !source.independenceGroup.trim() ||
      !source.independenceNote.trim(),
  );

  function invalidateReview() {
    setDraft(null);
    setApproved(false);
    setRegistration(null);
  }

  function updateSource(
    index: number,
    key: keyof SourceInput,
    value: string,
  ) {
    setSources((current) =>
      current.map((source, sourceIndex) =>
        sourceIndex === index ? { ...source, [key]: value } : source,
      ),
    );
    invalidateReview();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    invalidateReview();
    const response = (await postJson("/api/authoring/drafts", {
      patternId,
      name,
      intent,
      capability,
      evidenceStatus,
      sources: sources.map((source, index) => ({
        id: `source-${index + 1}`,
        repository: source.repository,
        stack: source.stack,
        isTargetStack: source.isTargetStack === "true",
        independenceGroup: source.independenceGroup,
        independenceNote: source.independenceNote,
      })),
    })) as DraftedResponse | ErrorResponse;
    if ("draftId" in response) setDraft(response);
    else setError(response);
    setBusy(false);
  }

  async function approve() {
    if (!draft || draft.selfVerify.status === "failed") return;
    setBusy(true);
    const response = (await postJson(
      `/api/authoring/drafts/${draft.draftId}/approve`,
      {},
    )) as { status: string; detail?: string };
    if (response.status === "approved") setApproved(true);
    else
      setError({
        status: response.status,
        detail: response.detail ?? "초안 승인이 거부되었습니다.",
      });
    setBusy(false);
  }

  async function register() {
    if (!draft || !approved) return;
    setBusy(true);
    setRegistration(
      (await postJson(
        `/api/authoring/drafts/${draft.draftId}/register`,
        {},
      )) as RegistrationResult,
    );
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12 text-white">
      <header>
        <p className="text-sm text-neutral-500">EXTRACT → ABSTRACT</p>
        <h1 className="mt-2 text-4xl font-semibold">카탈로그 저작</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-300">
          저장소와 의도를 입력하고 제안된 근거와 대조 결과를 검토한 뒤
          승인합니다. 후보 편집은 지원하지 않습니다.
        </p>
      </header>
      <form className="space-y-6" onSubmit={submit}>
        <Section title="1. 입력">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="patternId" onChange={setPatternId} value={patternId} />
            <TextInput label="name" onChange={setName} value={name} />
            <label className="text-sm text-neutral-300 sm:col-span-2">
              intent
              <textarea
                className="mt-1 block w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
                onChange={(event) => setIntent(event.target.value)}
                required
                value={intent}
              />
            </label>
            <label className="text-sm text-neutral-300">
              capability
              <select
                className="mt-1 block w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
                onChange={(event) =>
                  setCapability(event.target.value as Pattern["capability"])
                }
                value={capability}
              >
                <option value="descriptive">descriptive</option>
                <option value="generative">generative</option>
              </select>
            </label>
            <label className="text-sm text-neutral-300">
              evidenceStatus
              <select
                className="mt-1 block w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
                onChange={(event) =>
                  setEvidenceStatus(event.target.value as Pattern["evidenceStatus"])
                }
                value={evidenceStatus}
              >
                <option value="observed">observed</option>
                <option value="corroborated">corroborated</option>
              </select>
            </label>
          </div>
        </Section>
        <Section title="소스 저장소">
          <p className="text-sm text-neutral-400">
            independenceGroup과 isTargetStack은 큐레이터인 사용자가 직접
            판정합니다. 앱은 값을 채우거나 추천하지 않습니다.
          </p>
          {corroboratedNeedsSources && (
            <p className="mt-2 text-sm text-amber-500">
              corroborated 저작에는 소스 저장소가 2개 이상 필요합니다.
            </p>
          )}
          <div className="mt-4 space-y-4">
            {sources.map((source, index) => (
              <fieldset
                className="grid gap-3 border border-neutral-800 p-4 sm:grid-cols-2"
                key={index}
              >
                <legend className="px-2 text-xs text-neutral-500">
                  source-{index + 1}
                </legend>
                <TextInput label="repository" value={source.repository} onChange={(value) => updateSource(index, "repository", value)} />
                <TextInput label="stack" value={source.stack} onChange={(value) => updateSource(index, "stack", value)} />
                <TextInput label="independenceGroup" value={source.independenceGroup} onChange={(value) => updateSource(index, "independenceGroup", value)} />
                <TextInput label="independenceNote" value={source.independenceNote} onChange={(value) => updateSource(index, "independenceNote", value)} />
                <label className="text-sm text-neutral-300">
                  isTargetStack
                  <select
                    className="mt-1 block w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
                    onChange={(event) =>
                      updateSource(index, "isTargetStack", event.target.value)
                    }
                    required
                    value={source.isTargetStack}
                  >
                    <option value="">사용자가 판정하세요</option>
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                </label>
              </fieldset>
            ))}
          </div>
          <div className="mt-4 flex gap-4">
            <button className="text-sm text-neutral-500 hover:text-neutral-300" onClick={() => setSources((current) => [...current, emptySource()])} type="button">
              소스 추가
            </button>
            {sources.length > 1 && (
              <button className="text-sm text-neutral-500 hover:text-neutral-300" onClick={() => setSources((current) => current.slice(0, -1))} type="button">
                마지막 소스 제거
              </button>
            )}
          </div>
        </Section>
        <button
          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
          disabled={busy || corroboratedNeedsSources || sourceIncomplete || !patternId || !name || !intent}
          type="submit"
        >
          {busy ? "초안 생성 중…" : "초안 생성"}
        </button>
      </form>
      {error && (
        <div className="border-l-2 border-red-500 bg-[#141414] p-4 text-sm text-red-400">
          <p>{error.status}</p>
          <p className="mt-1">{error.detail}</p>
        </div>
      )}
      {draft && (
        <section className="space-y-4" aria-labelledby="draft-heading">
          <h2 id="draft-heading" className="text-lg font-semibold">2. 초안 검토</h2>
          <DraftReview
            approved={approved}
            approving={busy}
            draft={draft}
            onApprove={approve}
            onReject={() => {
              setDraft(null);
              setError({
                status: "draft-rejected",
                detail: "초안을 거부했습니다. 후보 편집 없이 새 초안을 요청할 수 있습니다.",
              });
            }}
          />
          <RegistrationButton
            approved={approved}
            busy={busy}
            onRegister={register}
          />
        </section>
      )}
      {registration && (
        <section aria-labelledby="registration-heading">
          <h2 id="registration-heading" className="mb-3 text-lg font-semibold">3. 등재 결과</h2>
          <RegistrationResultView result={registration} />
        </section>
      )}
    </div>
  );
}
