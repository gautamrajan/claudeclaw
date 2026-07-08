import type { Settings } from "../config";
import type { Job } from "../jobs";
import type { ApprovalRequest, ApprovalResult, ApprovalStatus } from "../approvals";

export interface WebSnapshot {
  pid: number;
  startedAt: number;
  heartbeatNextAt: number;
  settings: Settings;
  jobs: Job[];
  pendingApprovals?: ApprovalRequest[];
}

export interface WebServerHandle {
  stop: () => void;
  host: string;
  port: number;
}

export interface StartWebUiOptions {
  host: string;
  port: number;
  getSnapshot: () => WebSnapshot;
  onHeartbeatEnabledChanged?: (enabled: boolean) => void | Promise<void>;
  onHeartbeatSettingsChanged?: (patch: {
    enabled?: boolean;
    interval?: number;
    prompt?: string;
    excludeWindows?: Array<{ days?: number[]; start: string; end: string }>;
  }) => void | Promise<void>;
  onJobsChanged?: () => void | Promise<void>;
  onChat?: (
    message: string,
    onChunk: (text: string) => void,
    onUnblock: () => void
  ) => Promise<void>;
  /** Create a pending approval request. Returns the created request (including id). */
  onApprovalRequest?: (
    toolName: string,
    toolInput: unknown,
    description?: string,
  ) => Promise<ApprovalRequest>;
  /** Block up to waitMs for a resolution. Returns {status, result} where status reflects current state. */
  onApprovalAwait?: (
    id: string,
    waitMs: number,
  ) => Promise<{ status: ApprovalStatus; result: ApprovalResult | null }>;
  /** Resolve a pending approval with a decision. Returns true if resolved, false if already settled or unknown. */
  onApprovalResolve?: (
    id: string,
    result: { decision: "approve" | "approve_always" | "deny"; pattern?: string; reason?: string },
  ) => Promise<boolean>;
}
