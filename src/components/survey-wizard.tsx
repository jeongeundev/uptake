"use client";

import React, { useState, type FormEvent } from "react";

import type {
  AuthoringRequest,
  DiscardedCandidate,
  TargetStackFact,
} from "@/types/authoring";
import type { Pattern } from "@/types/pattern";
import type { SurveyCandidate } from "@/types/survey";

type ErrorResponse = { status: string; detail: string };
type SurveyedResponse = {
  status: "surveyed";
  surveyId: string;
  repository: string;
  revision: string;
  candidates: SurveyCandidate[];
  skipped: {
    path: string;
    ruleId: string;
    reason: "budget-exhausted" | "unreadable";
  }[];
  discardedEvidence: {
    candidateId: string;
    path: string;
    reason: "not-collected";
  }[];
  discardedCandidates: {
    candidateId: string;
    reason: "invalid-shape" | "duplicate-id" | "no-evidence";
    detail: string;
  }[];
};
type NoCandidateResponse = Omit<
  SurveyedResponse,
  "status" | "surveyId" | "candidates"
> & {
  status: "no-candidate";
  detail: string;
};
type AdoptedResponse = {
  status: "drafted";
  draftId: string;
  pattern: Pattern;
  authoringRequest: AuthoringRequest;
  discarded: DiscardedCandidate[];
  targetStackFacts: TargetStackFact[];
};
type RegistrationResult =
  | { status: "registered"; path: string }
  | ErrorResponse;

async function postJson(url: string, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return response.json();
}

function Panel({
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

function Limitations() {
  return (
    <aside className="border border-amber-900 bg-[#141414] p-5 text-sm leading-relaxed text-neutral-300">
      <h3 className="font-medium text-amber-500">이 결과의 범위</h3>
      <p className="mt-2">
        이 도구는 그 저장소가 만든 규율과 템플릿에서 상속된 규율을
        구분하지 않습니다. 결과에 보일러플레이트가 섞여 있을 수 있습니다.
      </p>
      <p className="mt-2">
        observed는 “이 저장소가 실제로 이렇게 한다”까지만 주장합니다. 다른
        곳도 그렇다거나 이것이 옳다는 주장이 아닙니다.
      </p>
    </aside>
  );
}

function Discards({ survey }: { survey: SurveyedResponse }) {
  return (
    <Panel title="폐기·수집 실패">
      <div className="space-y-5 text-sm">
        <div>
          <h4 className="text-neutral-300">
            폐기된 근거 · {survey.discardedEvidence.length}
          </h4>
          {survey.discardedEvidence.length === 0 ? (
            <p className="mt-2 text-neutral-500">폐기된 근거가 없습니다.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {survey.discardedEvidence.map((item, index) => (
                <li key={`${item.candidateId}:${item.path}:${index}`}>
                  <p className="font-mono text-xs text-neutral-300">
                    {item.candidateId} · {item.path}
                  </p>
                  <p className="text-red-400">{item.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-neutral-300">
            폐기된 후보 · {survey.discardedCandidates.length}
          </h4>
          {survey.discardedCandidates.length === 0 ? (
            <p className="mt-2 text-neutral-500">폐기된 후보가 없습니다.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {survey.discardedCandidates.map((item, index) => (
                <li key={`${item.candidateId}:${index}`}>
                  <p className="font-mono text-xs text-neutral-300">
                    {item.candidateId} · {item.reason}
                  </p>
                  <p className="text-red-400">{item.detail}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <h4 className="text-neutral-300">
            수집되지 않은 파일 · {survey.skipped.length}
          </h4>
          {survey.skipped.length === 0 ? (
            <p className="mt-2 text-neutral-500">수집 실패가 없습니다.</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {survey.skipped.map((item, index) => (
                <li key={`${item.ruleId}:${item.path}:${index}`}>
                  <p className="font-mono text-xs text-neutral-300">
                    {item.ruleId} · {item.path}
                  </p>
                  <p className="text-red-400">{item.reason}</p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Panel>
  );
}

export default function SurveyWizard() {
  const [repository, setRepository] = useState("");
  const [survey, setSurvey] = useState<SurveyedResponse | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<AdoptedResponse | null>(null);
  const [serverApproved, setServerApproved] = useState(false);
  const [registration, setRegistration] =
    useState<RegistrationResult | null>(null);
  const [error, setError] = useState<ErrorResponse | null>(null);
  const [busy, setBusy] = useState(false);

  async function investigate(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setSurvey(null);
    setSelectedId("");
    setDraft(null);
    setServerApproved(false);
    setRegistration(null);
    try {
      const response = (await postJson("/api/survey", {
        repository,
      })) as SurveyedResponse | NoCandidateResponse | ErrorResponse;
      if ("surveyId" in response) {
        setSurvey(response);
      } else if (
        response.status === "no-candidate" &&
        "revision" in response
      ) {
        setSurvey({
          ...response,
          status: "surveyed",
          surveyId: "",
          candidates: [],
        });
        setError({ status: response.status, detail: response.detail });
      } else {
        setError(response);
      }
    } catch (caught) {
      setError({
        status: caught instanceof SyntaxError ? "invalid-json" : "network-error",
        detail:
          caught instanceof Error
            ? caught.message
            : "SURVEY 요청을 처리하지 못했습니다.",
      });
    } finally {
      setBusy(false);
    }
  }

  async function adopt() {
    if (!survey || !selectedId) return;
    setBusy(true);
    setError(null);
    setDraft(null);
    setServerApproved(false);
    setRegistration(null);
    const response = (await postJson(
      `/api/survey/${survey.surveyId}/candidates/${selectedId}/adopt`,
      {},
    )) as AdoptedResponse | ErrorResponse;
    if ("draftId" in response) setDraft(response);
    else setError(response);
    setBusy(false);
  }

  async function approve() {
    if (!draft) return;
    setBusy(true);
    const response = (await postJson(
      `/api/authoring/drafts/${draft.draftId}/approve`,
      { request: draft.authoringRequest },
    )) as { status: string; detail?: string };
    if (response.status === "approved") setServerApproved(true);
    else
      setError({
        status: response.status,
        detail: response.detail ?? "초안 승인이 거부되었습니다.",
      });
    setBusy(false);
  }

  async function register() {
    if (!draft || !serverApproved) return;
    setBusy(true);
    const response = (await postJson(
      `/api/authoring/drafts/${draft.draftId}/register`,
      { request: draft.authoringRequest },
    )) as RegistrationResult;
    setRegistration(response);
    setBusy(false);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-12 text-white">
      <header>
        <p className="text-sm text-neutral-500">SURVEY</p>
        <h1 className="mt-2 text-4xl font-semibold">저장소 개발 체계 발견</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-neutral-300">
          저장소 하나를 고정된 revision에서 조사하고, 실재하는 근거 경로가
          남은 개발 체계 후보 중 하나를 고릅니다.
        </p>
      </header>

      <form className="flex items-end gap-3" onSubmit={investigate}>
        <label className="flex-1 text-sm text-neutral-300">
          저장소 식별자
          <input
            className="mt-1 block w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3"
            onChange={(event) => setRepository(event.target.value)}
            required
            value={repository}
          />
        </label>
        <button
          className="rounded-lg bg-white px-4 py-3 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500"
          disabled={busy || !repository.trim()}
          type="submit"
        >
          {busy ? "조사 중…" : "조사"}
        </button>
      </form>

      {error && (
        <div className="border-l-2 border-red-500 bg-[#141414] p-4 text-sm text-red-400">
          <p>{error.status}</p>
          <p className="mt-1">{error.detail}</p>
        </div>
      )}

      {survey && (
        <section className="space-y-4" aria-label="SURVEY 조사 결과">
          <div>
            <h2 className="text-lg font-semibold">후보 목록</h2>
            <p className="mt-1 text-sm text-neutral-400">조사 revision</p>
            <p className="font-mono text-xs text-neutral-300">
              {survey.revision}
            </p>
            <p className="mt-3 text-sm text-neutral-400">
              confidence는 판단 보조일 뿐이며 카탈로그 등재물에는 담기지
              않습니다.
            </p>
          </div>
          <Limitations />
          <div className="space-y-3">
            {survey.candidates.map((candidate) => (
              <label
                className="block border border-neutral-800 bg-[#141414] p-5"
                key={candidate.id}
              >
                <span className="flex items-start gap-3">
                  <input
                    checked={selectedId === candidate.id}
                    className="mt-1"
                    name="survey-candidate"
                    onChange={() => {
                      setSelectedId(candidate.id);
                      setDraft(null);
                      setServerApproved(false);
                      setRegistration(null);
                    }}
                    type="radio"
                  />
                  <span>
                    <span className="text-base font-medium text-white">
                      {candidate.name}
                    </span>
                    <span className="ml-2 font-mono text-xs text-neutral-500">
                      {candidate.id}
                    </span>
                  </span>
                </span>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="text-neutral-500">intent</dt>
                    <dd className="text-neutral-300">{candidate.intent}</dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">discipline</dt>
                    <dd className="text-neutral-300">
                      {candidate.discipline}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">tradeoffs</dt>
                    <dd className="text-neutral-300">
                      {candidate.tradeoffs}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">
                      confidence · 판단 보조
                    </dt>
                    <dd className="text-neutral-300">
                      {candidate.confidence}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-500">근거 경로</dt>
                    <dd>
                      <ul className="mt-1 space-y-1 font-mono text-xs text-neutral-400">
                        {candidate.evidence.map((path) => (
                          <li key={path}>{path}</li>
                        ))}
                      </ul>
                    </dd>
                  </div>
                </dl>
              </label>
            ))}
          </div>
          <button
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500"
            disabled={busy || !selectedId}
            onClick={adopt}
            type="button"
          >
            {busy ? "채택 중…" : "선택 후보 채택"}
          </button>
          <Discards survey={survey} />
        </section>
      )}

      {draft && (
        <section className="space-y-4" aria-label="SURVEY 채택 초안">
          <h2 className="text-lg font-semibold">채택 초안 검토</h2>
          <Limitations />
          <Panel title="조립된 패턴">
            <dl className="space-y-2 text-sm text-neutral-300">
              <div>
                <dt className="text-neutral-500">patternId · name</dt>
                <dd>
                  {draft.pattern.patternId} · {draft.pattern.name}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">분류</dt>
                <dd>
                  {draft.pattern.evidenceStatus} · {draft.pattern.capability}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-500">intent</dt>
                <dd>{draft.pattern.intent}</dd>
              </div>
              <div>
                <dt className="text-neutral-500">tradeoffs</dt>
                <dd>{draft.pattern.tradeoffs}</dd>
              </div>
            </dl>
          </Panel>
          <Panel title="Provenance">
            <ul className="space-y-2 font-mono text-xs text-neutral-400">
              {draft.pattern.provenance.map((item, index) => (
                <li key={`${item.sourceId}:${item.path}:${index}`}>
                  {item.sourceId} · {item.path} · {item.observedRole}
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Target stack 관찰 사실">
            <p className="mb-3 text-sm text-neutral-400">
              아래는 관찰 결과이며 타깃 스택 판정 문구가 아닙니다.
            </p>
            <ul className="space-y-2 text-sm text-neutral-300">
              {draft.targetStackFacts.map((fact) => (
                <li key={fact.sourceId}>
                  <p>
                    {fact.sourceId} ·{" "}
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
          </Panel>
          {draft.discarded.length > 0 && (
            <Panel title="채택 중 폐기된 근거">
              <ul className="space-y-2 text-sm text-red-400">
                {draft.discarded.map((item, index) => (
                  <li key={`${item.sourceId}:${item.path}:${index}`}>
                    <span className="font-mono text-xs">
                      {item.sourceId} · {item.path}
                    </span>
                    {" · "}
                    {item.reason}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <div className="flex gap-3">
            <button
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500"
              disabled={busy || serverApproved}
              onClick={approve}
              type="button"
            >
              {serverApproved ? "서버 승인 완료" : "초안 승인"}
            </button>
            <button
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:bg-neutral-800 disabled:text-neutral-500"
              disabled={busy || !serverApproved}
              onClick={register}
              type="button"
            >
              카탈로그 등재
            </button>
          </div>
        </section>
      )}

      {registration && (
        <section aria-label="SURVEY 등재 결과">
          {"path" in registration ? (
            <div className="border-l-2 border-green-500 pl-3 text-sm text-green-400">
              <p>카탈로그에 등재되었습니다.</p>
              <p className="mt-1 font-mono text-xs">{registration.path}</p>
            </div>
          ) : (
            <div className="border-l-2 border-red-500 pl-3 text-sm text-red-400">
              <p>카탈로그 등재에 실패했습니다.</p>
              <p className="mt-1">{registration.status}</p>
              <p className="mt-1">{registration.detail}</p>
              {registration.detail.includes("pattern-exists") && (
                <p className="mt-1">기존 패턴은 변경되지 않았습니다.</p>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
