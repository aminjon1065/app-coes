"use client";

import { useState } from "react";
import { Search, Download, SlidersHorizontal, ChevronLeft, ChevronRight, Info } from "lucide-react";

type EmailRow = {
  name: string;
  publishDate: string;
  sent: number;
  clickThrough: string;
  delivered: string;
  unsubscribed: string;
  spamReport: string;
};

const ALL_ROWS: EmailRow[] = [
  { name: "Notio Hive + Musemind", publishDate: "1/8/2022", sent: 5, clickThrough: "2.66%", delivered: "100%", unsubscribed: "100%", spamReport: "0.66%" },
  { name: "Engineering, Architecture & Design", publishDate: "17/8/2022", sent: 1, clickThrough: "3.04%", delivered: "100%", unsubscribed: "100%", spamReport: "0.90%   0.00%" },
  { name: "Financial Services", publishDate: "19/8/2022", sent: 3, clickThrough: "5.38%", delivered: "100%", unsubscribed: "100%", spamReport: "0.87%   1.07%" },
  { name: "Advertising & Marketing Agencies", publishDate: "20/8/2022", sent: 7, clickThrough: "3.50%", delivered: "100%", unsubscribed: "100%", spamReport: "0.20%   1.43%" },
  { name: "Healthcare Services", publishDate: "24/8/2022", sent: 12, clickThrough: "8.90%", delivered: "100%", unsubscribed: "100%", spamReport: "0.70%   0.00%" },
  { name: "IT / Tech / Software Services", publishDate: "30/8/2022", sent: 9, clickThrough: "7.15%", delivered: "100%", unsubscribed: "100%", spamReport: "0.99%   0.00%" },
  { name: "Logistics & Wholesale", publishDate: "4/9/2022", sent: 1, clickThrough: "2.80%", delivered: "100%", unsubscribed: "100%", spamReport: "0.92%   8.90%" },
  { name: "Media, Entertainment & Publishing", publishDate: "6/9/2022", sent: 1, clickThrough: "3.44%", delivered: "100%", unsubscribed: "100%", spamReport: "0.20%   0.00%" },
  { name: "Education", publishDate: "10/9/2022", sent: 2, clickThrough: "1.07%", delivered: "100%", unsubscribed: "100%", spamReport: "0.33%   3.04%" },
  { name: "Consumer Packaged Goods", publishDate: "11/9/2022", sent: 1, clickThrough: "1.43%", delivered: "100%", unsubscribed: "100%", spamReport: "0.50%   1.43%" },
];

const TABS = ["Sent Emails", "Campaigns"] as const;
type Tab = (typeof TABS)[number];

const HEADERS = [
  { key: "name", label: "Email" },
  { key: "publishDate", label: "Publish Date" },
  { key: "sent", label: "Sent" },
  { key: "clickThrough", label: "Click-Through Rate" },
  { key: "delivered", label: "Delivered Rate" },
  { key: "unsubscribed", label: "Unsubscribed Rate" },
  { key: "spamReport", label: "Spam Report Rate" },
];

const PAGE_SIZE = 10;

export function EmailPerformanceTable() {
  const [activeTab, setActiveTab] = useState<Tab>("Sent Emails");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const filtered = ALL_ROWS.filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const rows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleAll() {
    if (checked.size === rows.length) {
      setChecked(new Set());
    } else {
      setChecked(new Set(rows.map((r) => r.name)));
    }
  }

  function toggleRow(name: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  return (
    <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-[0_8px_32px_rgba(0,0,0,0.14)]">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold text-white">All Email Performance</h2>
        <Info className="h-3.5 w-3.5 text-slate-500" />
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg border border-white/10 bg-white/5 p-1">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setPage(1); }}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
                activeTab === tab
                  ? "bg-white/10 text-white"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm">
            <Search className="h-3.5 w-3.5 text-slate-500" />
            <input
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search..."
              className="w-40 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
            />
          </div>
          <button className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 transition">
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Manage Column
          </button>
          <button className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-500 transition">
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
        </div>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/8">
              <th className="w-8 pb-3 pr-3 text-left">
                <input
                  type="checkbox"
                  checked={checked.size === rows.length && rows.length > 0}
                  onChange={toggleAll}
                  className="rounded border-white/20 bg-white/10 accent-violet-500"
                />
              </th>
              {HEADERS.map((h) => (
                <th
                  key={h.key}
                  className="whitespace-nowrap pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-slate-500"
                >
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.name}
                className="border-b border-white/5 hover:bg-white/4 transition"
              >
                <td className="py-3 pr-3">
                  <input
                    type="checkbox"
                    checked={checked.has(row.name)}
                    onChange={() => toggleRow(row.name)}
                    className="rounded border-white/20 bg-white/10 accent-violet-500"
                  />
                </td>
                <td className="py-3 pr-4 font-medium text-white">{row.name}</td>
                <td className="py-3 pr-4 text-slate-400">{row.publishDate}</td>
                <td className="py-3 pr-4 text-slate-400">{row.sent}</td>
                <td className="py-3 pr-4 text-slate-300">{row.clickThrough}</td>
                <td className="py-3 pr-4 text-slate-300">{row.delivered}</td>
                <td className="py-3 pr-4 text-slate-300">{row.unsubscribed}</td>
                <td className="py-3 pr-4 text-slate-300">{row.spamReport}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center justify-between gap-4">
        <button
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page === 1}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40 transition"
        >
          <ChevronLeft className="h-4 w-4" />
          Previous
        </button>

        <div className="flex items-center gap-1">
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const p = i + 1;
            return (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`h-8 w-8 rounded-lg text-sm font-medium transition ${
                  page === p
                    ? "bg-violet-600 text-white"
                    : "text-slate-400 hover:bg-white/8 hover:text-white"
                }`}
              >
                {p}
              </button>
            );
          })}
          {totalPages > 5 && (
            <>
              <span className="px-1 text-slate-600">...</span>
              {[8, 9, 10].map((p) => (
                <button
                  key={p}
                  onClick={() => setPage(p)}
                  className={`h-8 w-8 rounded-lg text-sm font-medium transition ${
                    page === p
                      ? "bg-violet-600 text-white"
                      : "text-slate-400 hover:bg-white/8 hover:text-white"
                  }`}
                >
                  {p}
                </button>
              ))}
            </>
          )}
        </div>

        <button
          onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          disabled={page === totalPages}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-slate-300 hover:bg-white/10 disabled:opacity-40 transition"
        >
          Next
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </section>
  );
}
