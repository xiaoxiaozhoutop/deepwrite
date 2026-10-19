import { randomBytes } from "node:crypto";
import {
  CLOUD_BACKUP_QUOTA_BYTES,
  CloudBackupPreviewSchema,
  type CloudBackupItem,
  type CloudBackupPreview
} from "@deepwrite/contracts";
import { backupItemKey } from "./diff";
import type { CloudBackupSnapshotManifest } from "./packager";

const PREVIEW_TTL_MS = 10 * 60 * 1000;

export interface StoredBackupPreview {
  direction: "upload" | "download";
  machineKey: string;
  remote: CloudBackupSnapshotManifest | null;
  localItems?: CloudBackupItem[];
  totalBytes: number;
  changes: CloudBackupPreview["changes"];
  packed?: { manifest: CloudBackupSnapshotManifest; zip: Buffer };
}

/** Owns expiring, single-use confirmations and the snapshots they approved. */
export class CloudBackupPreviewStore {
  private readonly entries = new Map<
    string,
    { createdAt: number; preview: StoredBackupPreview }
  >();

  remember(preview: StoredBackupPreview): CloudBackupPreview {
    this.expire();
    const id = `preview_${randomBytes(8).toString("hex")}`;
    const result = CloudBackupPreviewSchema.parse({
      previewId: id,
      direction: preview.direction,
      machineKey: preview.machineKey,
      remoteUpdatedAt: preview.remote?.updatedAt ?? null,
      totalBytes: preview.totalBytes,
      quotaBytes: CLOUD_BACKUP_QUOTA_BYTES,
      changes: preview.changes
    });
    this.entries.set(id, { createdAt: Date.now(), preview });
    return result;
  }

  take(
    id: string,
    direction: StoredBackupPreview["direction"]
  ): StoredBackupPreview {
    this.expire();
    const entry = this.entries.get(id);
    if (!entry || entry.preview.direction !== direction) {
      throw new Error("同步预览已过期，请重新确认后再继续。");
    }
    this.entries.delete(id);
    return entry.preview;
  }

  private expire(): void {
    const cutoff = Date.now() - PREVIEW_TTL_MS;
    for (const [id, entry] of this.entries) {
      if (entry.createdAt < cutoff) this.entries.delete(id);
    }
  }
}

export function assertRestorePreviewLocalCurrent(
  preview: StoredBackupPreview,
  localItems: readonly CloudBackupItem[]
): void {
  const before = new Map(
    (preview.localItems ?? []).map((item) => [backupItemKey(item), item.hash])
  );
  const current = new Map(
    localItems.map((item) => [backupItemKey(item), item.hash])
  );
  for (const change of preview.changes) {
    if (change.change !== "add" && change.change !== "overwrite") continue;
    const key = backupItemKey(change);
    if (before.get(key) !== current.get(key)) {
      throw new Error("本地内容在预览后发生变化，请重新预览后再同步。");
    }
  }
}
