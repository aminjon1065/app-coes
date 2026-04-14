"use client";

import { useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  buildIncidentDirectoryQuery,
  INCIDENT_SORT_OPTIONS,
  type IncidentDirectoryFilters,
} from "@/lib/api/incident-workspace";
import { cn } from "@/lib/utils";

type IncidentSavedFilter = {
  id: string;
  label: string;
  filters: IncidentDirectoryFilters;
  createdAt: string;
};

type IncidentDirectoryToolbarProps = {
  currentFilters: IncidentDirectoryFilters;
};

const STORAGE_KEY = "coescd.incident_directory.saved_filters.v1";
const STORAGE_EVENT = "coescd:incident-directory-saved-filters";
const MAX_SAVED_FILTERS = 6;

function normalizeFilters(filters: IncidentDirectoryFilters): IncidentDirectoryFilters {
  return {
    q: filters.q?.trim() || undefined,
    status: filters.status || undefined,
    category: filters.category || undefined,
    severity: filters.severity || undefined,
    sort: filters.sort || undefined,
  };
}

function serializeFilters(filters: IncidentDirectoryFilters) {
  const normalized = normalizeFilters(filters);

  return JSON.stringify({
    q: normalized.q ?? "",
    status: normalized.status ?? "",
    category: normalized.category ?? "",
    severity: normalized.severity ?? "",
    sort: normalized.sort ?? "newest",
  });
}

function readSavedFiltersSnapshot(): IncidentSavedFilter[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is IncidentSavedFilter => {
      return Boolean(
        item &&
          typeof item === "object" &&
          "id" in item &&
          "label" in item &&
          "filters" in item,
      );
    });
  } catch {
    return [];
  }
}

function subscribeSavedFilters(callback: () => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = () => callback();

  window.addEventListener("storage", handleStorage);
  window.addEventListener(STORAGE_EVENT, handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(STORAGE_EVENT, handleStorage);
  };
}

function writeSavedFilters(nextFilters: IncidentSavedFilter[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nextFilters));
  window.dispatchEvent(new Event(STORAGE_EVENT));
}

function buildFilterLabel(filters: IncidentDirectoryFilters) {
  const parts: string[] = [];

  if (filters.q?.trim()) {
    parts.push(`q:${filters.q.trim()}`);
  }
  if (filters.status) {
    parts.push(filters.status);
  }
  if (filters.category) {
    parts.push(filters.category);
  }
  if (filters.severity) {
    parts.push(`sev ${filters.severity}`);
  }
  if (filters.sort && filters.sort !== "newest") {
    const label =
      INCIDENT_SORT_OPTIONS.find((item) => item.value === filters.sort)?.label ??
      filters.sort;
    parts.push(label);
  }

  return parts.slice(0, 3).join(" • ") || "Filtered incidents";
}

export function IncidentDirectoryToolbar({
  currentFilters,
}: IncidentDirectoryToolbarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const savedFilters = useSyncExternalStore(
    subscribeSavedFilters,
    readSavedFiltersSnapshot,
    () => [],
  );
  const activeSort = currentFilters.sort ?? "newest";
  const currentSignature = serializeFilters(currentFilters);
  const canSaveCurrent =
    Boolean(currentFilters.q?.trim()) ||
    Boolean(currentFilters.status) ||
    Boolean(currentFilters.category) ||
    Boolean(currentFilters.severity) ||
    activeSort !== "newest";

  function navigate(filters: IncidentDirectoryFilters) {
    const query = buildIncidentDirectoryQuery(filters);
    router.replace(`${pathname}${query}`);
    router.refresh();
  }

  function saveCurrentFilter() {
    if (!canSaveCurrent) {
      return;
    }

    const normalized = normalizeFilters(currentFilters);
    const nextItem: IncidentSavedFilter = {
      id: crypto.randomUUID(),
      label: buildFilterLabel(normalized),
      filters: normalized,
      createdAt: new Date().toISOString(),
    };
    const nextFilters = [
      nextItem,
      ...savedFilters.filter(
        (item) => serializeFilters(item.filters) !== currentSignature,
      ),
    ].slice(0, MAX_SAVED_FILTERS);

    writeSavedFilters(nextFilters);
  }

  function removeSavedFilter(id: string) {
    writeSavedFilters(savedFilters.filter((item) => item.id !== id));
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="rounded-[26px] border border-white/10 bg-black/15 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Sort presets
            </div>
            <div className="mt-1 text-sm text-slate-400">
              Apply a stable list order without rebuilding the rest of the filter set.
            </div>
          </div>
          <button
            type="button"
            onClick={saveCurrentFilter}
            disabled={!canSaveCurrent}
            className="inline-flex items-center rounded-full border border-cyan-300/30 bg-cyan-300/10 px-4 py-2 text-sm font-medium text-cyan-50 transition hover:bg-cyan-300/16 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save current filter
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {INCIDENT_SORT_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() =>
                navigate({
                  ...currentFilters,
                  sort: option.value,
                })
              }
              className={cn(
                "rounded-full border px-3 py-1.5 text-sm transition",
                activeSort === option.value
                  ? "border-cyan-300/30 bg-cyan-300/10 text-cyan-50"
                  : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-[26px] border border-white/10 bg-black/15 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-500">
              Saved filters
            </div>
            <div className="mt-1 text-sm text-slate-400">
              Keep common filter combinations close to the incident index.
            </div>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
            {savedFilters.length}/{MAX_SAVED_FILTERS}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {savedFilters.length > 0 ? (
            savedFilters.map((item) => {
              const active = serializeFilters(item.filters) === currentSignature;

              return (
                <div
                  key={item.id}
                  className={cn(
                    "flex items-center overflow-hidden rounded-full border",
                    active
                      ? "border-cyan-300/30 bg-cyan-300/10"
                      : "border-white/10 bg-white/5",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => navigate(item.filters)}
                    className={cn(
                      "px-3 py-1.5 text-sm transition",
                      active
                        ? "text-cyan-50"
                        : "text-slate-300 hover:bg-white/10",
                    )}
                  >
                    {item.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeSavedFilter(item.id)}
                    className="border-l border-white/10 px-3 py-1.5 text-xs text-slate-400 transition hover:bg-rose-400/10 hover:text-rose-100"
                    aria-label={`Remove ${item.label}`}
                  >
                    Remove
                  </button>
                </div>
              );
            })
          ) : (
            <div className="rounded-[22px] border border-dashed border-white/10 bg-black/10 px-4 py-8 text-center text-sm text-slate-500">
              No saved filters yet. Apply a useful combination, then save it here.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
