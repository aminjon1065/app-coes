export type DocumentLifecycleState =
  | "DRAFT"
  | "REVIEW"
  | "APPROVED"
  | "PUBLISHED"
  | "ARCHIVED"
  | "REVOKED";

export type DocumentApprovalStatus = "PENDING" | "APPROVED" | "REJECTED";

export type DocumentIncidentSummary = {
  id: string;
  code?: string;
  title?: string;
};

export type DocumentUserSummary = {
  id: string;
  email?: string;
  fullName?: string;
};

export type DocumentVersionDto = {
  id: string;
  documentId: string;
  versionNumber: number;
  storageBucket: string;
  storageKey: string;
  checksumSha256: string;
  sizeBytes: string;
  renderedAt: string | null;
  createdBy: string;
  createdAt: string;
};

export type DocumentApprovalDto = {
  id: string;
  documentId: string;
  versionId: string;
  approverId: string;
  status: DocumentApprovalStatus;
  comment: string | null;
  signedAt: string | null;
  createdAt: string;
  approver?: DocumentUserSummary | null;
};

export type DocumentDto = {
  id: string;
  tenantId?: string;
  incidentId: string | null;
  title: string;
  templateCode: string;
  classification: number;
  lifecycleState: DocumentLifecycleState;
  currentVersionId: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  currentVersion?: DocumentVersionDto | null;
  versions?: DocumentVersionDto[];
  approvals?: DocumentApprovalDto[];
  incident?: DocumentIncidentSummary | null;
  creator?: DocumentUserSummary | null;
};

export type DocumentWorkspace = {
  source: "api" | "mock";
  documents: DocumentDto[];
  selectedDocument: DocumentDto | null;
  refreshedAt: string;
};

export const DOCUMENT_TEMPLATE_OPTIONS = [
  {
    code: "initial-report",
    label: "Initial report",
    fields: ["summary", "impact", "immediateActions"],
  },
  {
    code: "evacuation-order",
    label: "Evacuation order",
    fields: ["area", "route", "deadline", "authority"],
  },
  {
    code: "post-incident-report",
    label: "Post-incident report",
    fields: ["summary", "lessons", "recommendations"],
  },
] as const;

export const DOCUMENT_STATE_OPTIONS = [
  "DRAFT",
  "REVIEW",
  "APPROVED",
  "PUBLISHED",
  "ARCHIVED",
  "REVOKED",
] as const;

const API_BASE_URL =
  process.env.COESCD_API_BASE_URL ??
  process.env.NEXT_PUBLIC_COESCD_API_BASE_URL ??
  "http://localhost:3001/api/v1";

const API_TOKEN =
  process.env.COESCD_API_TOKEN ?? process.env.NEXT_PUBLIC_COESCD_API_TOKEN;

async function fetchDocumentApi<T>(path: string): Promise<T> {
  const headers: HeadersInit = {
    Accept: "application/json",
  };

  if (API_TOKEN) {
    headers.Authorization = `Bearer ${API_TOKEN}`;
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers,
    cache: "no-store",
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) {
    throw new Error(`Document request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

function buildQuery(params: Record<string, string | null | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value) {
      searchParams.set(key, value);
    }
  }

  const query = searchParams.toString();
  return query ? `?${query}` : "";
}

function mockDocuments(): DocumentDto[] {
  const now = new Date().toISOString();

  return [
    {
      id: "mock-initial-report",
      incidentId: null,
      title: "Initial flood impact report",
      templateCode: "initial-report",
      classification: 2,
      lifecycleState: "REVIEW",
      currentVersionId: "mock-version-1",
      createdBy: "mock-commander",
      createdAt: now,
      updatedAt: now,
      metadata: { templateVars: { summary: "Mock report pending backend connection." } },
      currentVersion: {
        id: "mock-version-1",
        documentId: "mock-initial-report",
        versionNumber: 1,
        storageBucket: "mock",
        storageKey: "mock.pdf",
        checksumSha256: "mock",
        sizeBytes: "1024",
        renderedAt: now,
        createdBy: "mock-commander",
        createdAt: now,
      },
      versions: [],
      approvals: [
        {
          id: "mock-approval-1",
          documentId: "mock-initial-report",
          versionId: "mock-version-1",
          approverId: "shift-lead",
          status: "PENDING",
          comment: null,
          signedAt: null,
          createdAt: now,
        },
      ],
    },
  ];
}

export function formatDocumentTimestamp(value: string | null | undefined) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function documentTemplateLabel(templateCode: string) {
  return (
    DOCUMENT_TEMPLATE_OPTIONS.find((template) => template.code === templateCode)?.label ??
    templateCode
  );
}

export async function loadDocumentWorkspace({
  documentId,
  state,
  incidentId,
  templateCode,
}: {
  documentId?: string | null;
  state?: string | null;
  incidentId?: string | null;
  templateCode?: string | null;
} = {}): Promise<DocumentWorkspace> {
  try {
    const listResponse = await fetchDocumentApi<{ data: DocumentDto[] }>(
      `/documents${buildQuery({ state, incidentId, templateCode })}`,
    );
    const selectedDocument = documentId
      ? (await fetchDocumentApi<{ data: DocumentDto }>(`/documents/${documentId}`)).data
      : listResponse.data[0] ?? null;

    return {
      source: "api",
      documents: listResponse.data,
      selectedDocument,
      refreshedAt: new Date().toISOString(),
    };
  } catch {
    const documents = mockDocuments();

    return {
      source: "mock",
      documents,
      selectedDocument:
        documents.find((document) => document.id === documentId) ?? documents[0] ?? null,
      refreshedAt: new Date().toISOString(),
    };
  }
}
