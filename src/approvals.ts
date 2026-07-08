import { randomUUID } from "crypto";

export type ApprovalDecision = "approve" | "approve_always" | "deny";

export interface ApprovalResult {
  decision: ApprovalDecision;
  pattern?: string;
  reason?: string;
  resolvedAt: number;
}

export type ApprovalStatus = "pending" | "resolved" | "expired";

export interface ApprovalRequest {
  id: string;
  toolName: string;
  toolInput: unknown;
  description: string;
  createdAt: number;
  status: ApprovalStatus;
}

interface PendingEntry {
  request: ApprovalRequest;
  waiters: Array<(result: ApprovalResult | null) => void>;
  result: ApprovalResult | null;
}

export interface ApprovalQueueOptions {
  onCreate?: (request: ApprovalRequest) => void | Promise<void>;
  retainResolvedMs?: number;
}

export class ApprovalQueue {
  private entries = new Map<string, PendingEntry>();
  private onCreate?: (request: ApprovalRequest) => void | Promise<void>;
  private retainResolvedMs: number;

  constructor(opts: ApprovalQueueOptions = {}) {
    this.onCreate = opts.onCreate;
    this.retainResolvedMs = opts.retainResolvedMs ?? 5 * 60 * 1000;
  }

  async create(
    toolName: string,
    toolInput: unknown,
    description?: string,
  ): Promise<ApprovalRequest> {
    const id = randomUUID();
    const request: ApprovalRequest = {
      id,
      toolName,
      toolInput,
      description: description ?? summarizeTool(toolName, toolInput),
      createdAt: Date.now(),
      status: "pending",
    };
    this.entries.set(id, { request, waiters: [], result: null });
    if (this.onCreate) {
      try {
        await this.onCreate(request);
      } catch (err) {
        console.error("[approvals] onCreate failed:", err);
      }
    }
    return request;
  }

  async awaitResult(id: string, waitMs: number): Promise<{ status: ApprovalStatus; result: ApprovalResult | null }> {
    const entry = this.entries.get(id);
    if (!entry) return { status: "expired", result: null };
    if (entry.request.status !== "pending") {
      return { status: entry.request.status, result: entry.result };
    }

    return new Promise((resolve) => {
      let settled = false;
      const settle = (result: ApprovalResult | null) => {
        if (settled) return;
        settled = true;
        const current = this.entries.get(id);
        const status = current?.request.status ?? "expired";
        resolve({ status, result });
      };
      entry.waiters.push(settle);
      setTimeout(() => settle(entry.result), waitMs).unref?.();
    });
  }

  resolve(id: string, result: Omit<ApprovalResult, "resolvedAt">): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.request.status !== "pending") return false;
    const full: ApprovalResult = { ...result, resolvedAt: Date.now() };
    entry.request.status = "resolved";
    entry.result = full;
    for (const w of entry.waiters.splice(0)) w(full);
    return true;
  }

  expire(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.request.status !== "pending") return false;
    entry.request.status = "expired";
    for (const w of entry.waiters.splice(0)) w(null);
    return true;
  }

  getPending(): ApprovalRequest[] {
    return Array.from(this.entries.values())
      .filter((e) => e.request.status === "pending")
      .map((e) => e.request);
  }

  getRequest(id: string): ApprovalRequest | null {
    return this.entries.get(id)?.request ?? null;
  }

  sweep(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.request.status === "pending") continue;
      const resolvedAt = entry.result?.resolvedAt ?? entry.request.createdAt;
      if (now - resolvedAt > this.retainResolvedMs) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

function summarizeTool(toolName: string, toolInput: unknown): string {
  if (toolName === "Bash" && toolInput && typeof toolInput === "object") {
    const cmd = (toolInput as Record<string, unknown>).command;
    if (typeof cmd === "string") {
      return `Bash: ${cmd.length > 200 ? cmd.slice(0, 197) + "..." : cmd}`;
    }
  }
  if (toolName && toolInput && typeof toolInput === "object") {
    const brief = JSON.stringify(toolInput).slice(0, 200);
    return `${toolName}: ${brief}`;
  }
  return toolName;
}
