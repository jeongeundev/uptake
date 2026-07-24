"use client";

import React, { useEffect, useState, type FormEvent } from "react";
import type { Pattern } from "@/types/pattern";

export type CatalogResponse = {
  loaded: { pattern: Pattern; generationEnabled: boolean }[];
  rejected: { file: string; reason: string; detail?: string }[];
};
type Binding = {
  bindingId: string;
  kind: "spec-format" | "checker" | "gate-location" | "naming";
  status: "detected" | "user-provided" | "binding-unresolved";
  value?: string;
  evidence?: { path: string }[];
};
type WorkflowResponse =
  | { status: "bindings-ready"; workflowId: string; bindings: Binding[] }
  | { status: string; detail: string };

export function bindingsComplete(
  bindings: Binding[],
  values: Readonly<Record<string, string>>,
) {
  return bindings.every(
    (binding) =>
      binding.status !== "binding-unresolved" ||
      Boolean(values[binding.bindingId]?.trim()),
  );
}

export function CatalogView({
  catalog,
  selectedPatternId,
  onSelect,
}: {
  catalog: CatalogResponse;
  selectedPatternId: string | null;
  onSelect: (patternId: string) => void;
}) {
  return (
    <section aria-labelledby="catalog-heading" className="space-y-4">
      <div>
        <p className="text-xs text-neutral-500">Step 1 · Current</p>
        <h2 id="catalog-heading" className="text-lg font-semibold">Catalog</h2>
      </div>
      {catalog.rejected.length > 0 && (
        <div aria-label="Rejected catalog patterns" className="border-l-2 border-red-500 bg-[#141414] p-4">
          <h3 className="text-sm font-medium text-red-400">Load rejections</h3>
          <ul className="mt-3 space-y-3">
            {catalog.rejected.map((item) => (
              <li key={`${item.file}:${item.reason}`}>
                <p className="font-mono text-xs text-neutral-300">{item.file}</p>
                <p className="text-sm text-red-400">{item.reason}</p>
                {item.detail && <p className="text-sm text-neutral-400">{item.detail}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {catalog.loaded.length === 0 && (
        <p className="border border-neutral-800 bg-[#141414] p-4 text-sm text-neutral-400">
          No patterns loaded. Review the load rejections above.
        </p>
      )}
      <div className="space-y-3">
        {catalog.loaded.map(({ pattern, generationEnabled }) => {
          const sources = new Map(pattern.sources.map((source) => [source.id, source]));
          return (
            <article className="border border-neutral-800 bg-[#141414] p-5" key={pattern.patternId}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="font-medium">{pattern.name}</h3>
                  <p className="font-mono text-xs text-neutral-500">{pattern.patternId}</p>
                </div>
                <p className="text-xs text-neutral-400">
                  {pattern.capability} · {pattern.evidenceStatus} · generationEnabled={String(generationEnabled)}
                </p>
              </div>
              <p className="mt-4 text-sm leading-relaxed text-neutral-300">{pattern.intent}</p>
              <p className="mt-4 text-xs font-medium text-neutral-500">Tradeoffs</p>
              <p className="mt-1 text-sm text-neutral-400">{pattern.tradeoffs}</p>
              <p className="mt-4 text-xs font-medium text-neutral-500">Provenance</p>
              <ul className="mt-1 space-y-1 font-mono text-xs text-neutral-400">
                {pattern.provenance.map((item, index) => {
                  const source = sources.get(item.sourceId);
                  return (
                    <li key={`${item.sourceId}:${item.path}:${index}`}>
                      {source?.repository ?? item.sourceId} · {source?.revision ?? "unknown revision"} · {item.path}
                    </li>
                  );
                })}
              </ul>
              {!generationEnabled && (
                <p className="mt-4 text-sm text-amber-500">
                  Generation requires a generative, corroborated pattern.
                </p>
              )}
              <button
                className="mt-4 rounded-lg bg-white px-4 py-2 text-sm font-medium text-black enabled:hover:bg-neutral-200 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
                disabled={!generationEnabled}
                onClick={() => onSelect(pattern.patternId)}
                type="button"
              >
                {selectedPatternId === pattern.patternId ? "Selected" : "Select pattern"}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function BindingsView({
  bindings, values, saving, onChange, onContinue,
}: {
  bindings: Binding[];
  values: Readonly<Record<string, string>>;
  saving: boolean;
  onChange: (bindingId: string, value: string) => void;
  onContinue: () => void;
}) {
  return (
    <section aria-labelledby="bindings-heading" className="space-y-4">
      <div>
        <p className="text-xs text-neutral-500">Step 2 · Current</p>
        <h2 id="bindings-heading" className="text-lg font-semibold">Bindings</h2>
      </div>
      <div className="space-y-3">
        {bindings.map((binding) => (
          <article className="border border-neutral-800 bg-[#141414] p-4" key={binding.bindingId}>
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-mono text-sm">{binding.bindingId}</h3>
              <p className="text-xs text-neutral-400">{binding.kind} · {binding.status}</p>
            </div>
            {binding.status === "binding-unresolved" ? (
              <input
                aria-label={`${binding.bindingId} value`}
                className="mt-3 w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-sm"
                name={binding.bindingId}
                onChange={(event) => onChange(binding.bindingId, event.currentTarget.value)}
                placeholder="Required value"
                type="text"
                value={values[binding.bindingId] ?? ""}
              />
            ) : (
              <>
                <p className="mt-3 font-mono text-xs text-neutral-300">{binding.value}</p>
                <ul className="mt-2 font-mono text-xs text-neutral-500">
                  {binding.evidence?.map(({ path }) => <li key={path}>{path}</li>)}
                </ul>
              </>
            )}
          </article>
        ))}
      </div>
      <button
        className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:bg-neutral-800 disabled:text-neutral-500"
        disabled={!bindingsComplete(bindings, values) || saving}
        onClick={onContinue}
        type="button"
      >
        {saving ? "Saving…" : "Save bindings"}
      </button>
    </section>
  );
}

export default function CatalogBindingsWizard() {
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [selectedPatternId, setSelectedPatternId] = useState<string | null>(null);
  const [targetRepoRoot, setTargetRepoRoot] = useState("");
  const [workflowId, setWorkflowId] = useState<string | null>(null);
  const [bindings, setBindings] = useState<Binding[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [bindingsSaved, setBindingsSaved] = useState(false);

  useEffect(() => {
    fetch("/api/catalog")
      .then((response) => response.json() as Promise<CatalogResponse>)
      .then(setCatalog)
      .catch(() => setError("Catalog request failed."));
  }, []);

  async function startWorkflow(event: FormEvent) {
    event.preventDefault();
    if (!selectedPatternId) return;
    setError(null);
    const response = await fetch("/api/workflows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ patternId: selectedPatternId, targetRepoRoot }),
    });
    const result = (await response.json()) as WorkflowResponse;
    if (!("workflowId" in result)) {
      return setError("detail" in result ? result.detail : "Workflow request failed.");
    }
    setWorkflowId(result.workflowId);
    setBindings(result.bindings);
    setValues({});
  }

  async function saveBindings() {
    if (!workflowId) return;
    setSaving(true);
    setError(null);
    const response = await fetch(`/api/workflows/${workflowId}/bindings`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ values }),
    });
    const result = (await response.json()) as WorkflowResponse;
    setSaving(false);
    if (!("workflowId" in result)) {
      return setError("detail" in result ? result.detail : "Binding update failed.");
    }
    setBindings(result.bindings);
    setBindingsSaved(true);
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl space-y-8 px-6 py-10 text-white">
      <header>
        <h1 className="text-4xl font-semibold">uptake</h1>
        <p className="mt-2 text-sm text-neutral-400">Select a pattern and bind it to a local target.</p>
      </header>
      {error && <p aria-live="polite" className="border-l-2 border-red-500 bg-[#141414] p-4 text-sm text-red-400">{error}</p>}
      {catalog ? (
        <CatalogView
          catalog={catalog}
          onSelect={(id) => { setSelectedPatternId(id); setWorkflowId(null); setBindingsSaved(false); }}
          selectedPatternId={selectedPatternId}
        />
      ) : <p className="text-sm text-neutral-400">Loading catalog…</p>}
      {selectedPatternId && !workflowId && (
        <form className="space-y-3" onSubmit={startWorkflow}>
          <p className="text-xs text-neutral-500">Step 2 · Next</p>
          <label className="block text-sm font-medium" htmlFor="targetRepoRoot">Absolute target repository path</label>
          <input className="w-full rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 font-mono text-sm" id="targetRepoRoot" onChange={(event) => setTargetRepoRoot(event.currentTarget.value)} required value={targetRepoRoot} />
          <button className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black" type="submit">Start workflow</button>
        </form>
      )}
      {workflowId && (
        <BindingsView
          bindings={bindings}
          onChange={(id, value) => setValues((current) => ({ ...current, [id]: value }))}
          onContinue={saveBindings}
          saving={saving}
          values={values}
        />
      )}
      {bindingsSaved && <p className="border-l-2 border-neutral-600 pl-4 text-sm text-neutral-400">Bindings complete. Verification is implemented in the next step.</p>}
    </main>
  );
}
