import { describe, it, expect } from "vitest";
import {
  assertZeroTokenPersistence,
  createGmailConnectionStub,
  createDriveConnectionStub,
  isGmailMessageAlreadyProcessed,
  isDriveFileAlreadyProcessed,
} from "@/lib/providers/provider-stubs";

describe("Provider Architecture Stubs (Token-Safety & Idempotency)", () => {
  describe("Zero Token Persistence Assertion", () => {
    it("accepts safe metadata without sensitive authentication secrets", () => {
      const safeConfig = {
        email: "user@example.com",
        syncFolderId: "folder-1234",
        syncFrequency: "hourly",
        lastSyncTime: "2026-09-16T10:00:00.000Z",
      };

      expect(() => assertZeroTokenPersistence(safeConfig)).not.toThrow();
    });

    it("throws error if metadata contains 'token' or 'access_token'", () => {
      const unsafeConfig = {
        email: "user@example.com",
        access_token: "ya29.a0AfH6SM...",
      };

      expect(() => assertZeroTokenPersistence(unsafeConfig)).toThrow(
        /Zero-token safety violation: detected prohibited credential key "access_token"/i
      );
    });

    it("throws error if metadata contains 'refresh_token'", () => {
      const unsafeConfig = {
        email: "user@example.com",
        refresh_token: "1//04...",
      };

      expect(() => assertZeroTokenPersistence(unsafeConfig)).toThrow(
        /Zero-token safety violation: detected prohibited credential key "refresh_token"/i
      );
    });

    it("throws error if metadata contains nested secret keys", () => {
      const nestedUnsafe = {
        user: "test",
        oauth: {
          client_secret: "super-secret",
        },
      };

      expect(() => assertZeroTokenPersistence(nestedUnsafe)).toThrow(
        /Zero-token safety violation: detected prohibited credential key "client_secret"/i
      );
    });

    it("throws error if metadata contains 'password' or 'private_key'", () => {
      expect(() => assertZeroTokenPersistence({ password: "admin" })).toThrow(/password/i);
      expect(() => assertZeroTokenPersistence({ private_key: "key" })).toThrow(/private_key/i);
    });
  });

  describe("Gmail Connection Stub", () => {
    it("creates a connection stub with valid zero-token metadata", () => {
      const stub = createGmailConnectionStub("alice@example.com", {
        watchLabel: "FINANCIAL_SLIPS",
      });

      expect(stub.provider).toBe("gmail");
      expect(stub.status).toBe("active");
      expect(stub.config.email).toBe("alice@example.com");
      expect(stub.config.watchLabel).toBe("FINANCIAL_SLIPS");
      expect(stub.config.tokenPersistence).toBe("disabled");

      // Verify zero token safety passes
      expect(() => assertZeroTokenPersistence(stub.config)).not.toThrow();
    });

    it("detects and prevents reprocessing of the same Gmail message ID (idempotency)", () => {
      const existingIds = ["MSG-100", "MSG-101", "MSG-102"];

      // Duplicate message
      const isDupe = isGmailMessageAlreadyProcessed("MSG-101", existingIds);
      expect(isDupe).toBe(true);

      // New message
      const isNew = isGmailMessageAlreadyProcessed("MSG-103", existingIds);
      expect(isNew).toBe(false);
    });
  });

  describe("Google Drive Connection Stub", () => {
    it("creates a Drive connection stub with valid zero-token metadata", () => {
      const stub = createDriveConnectionStub("alice@example.com", "folder-receipts-2026", {
        includeSubfolders: true,
      });

      expect(stub.provider).toBe("google_drive");
      expect(stub.status).toBe("active");
      expect(stub.config.email).toBe("alice@example.com");
      expect(stub.config.folderId).toBe("folder-receipts-2026");
      expect(stub.config.includeSubfolders).toBe(true);
      expect(stub.config.tokenPersistence).toBe("disabled");

      // Verify zero token safety passes
      expect(() => assertZeroTokenPersistence(stub.config)).not.toThrow();
    });

    it("detects if a Drive file is unchanged using fileId and modifiedTime (idempotency)", () => {
      const existingMetadata = [
        { fileId: "drive-file-1", modifiedTime: "2026-09-10T10:00:00.000Z" },
        { fileId: "drive-file-2", modifiedTime: "2026-09-12T14:00:00.000Z" },
      ];

      // Unchanged file -> already processed
      const unchanged = isDriveFileAlreadyProcessed(
        "drive-file-1",
        "2026-09-10T10:00:00.000Z",
        existingMetadata
      );
      expect(unchanged).toBe(true);

      // Modified file -> should be re-evaluated
      const modified = isDriveFileAlreadyProcessed(
        "drive-file-1",
        "2026-09-15T09:00:00.000Z",
        existingMetadata
      );
      expect(modified).toBe(false);

      // Brand new file -> not yet processed
      const brandNew = isDriveFileAlreadyProcessed(
        "drive-file-3",
        "2026-09-16T08:00:00.000Z",
        existingMetadata
      );
      expect(brandNew).toBe(false);
    });
  });
});
