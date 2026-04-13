import crypto from "node:crypto";
import { eq } from "@repo/db";
import {
  dispatchDevice,
  dispatchMessage,
} from "@repo/db/drizzle-schema";
import { TRPCError } from "@trpc/server";

import type { TRPCContext } from "../trpc";
import { createTRPCRouter, protectedProcedure, publicProcedure } from "../trpc";
import {
  heartbeatInput,
  pairDeviceInput,
  pollMessagesInput,
  pollResponsesInput,
  registerDeviceInput,
  respondInput,
  sendMessageInput,
} from "./dispatch-schema";

/** Generate a cryptographically random 6-char uppercase alphanumeric code */
function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/1/O/0 to avoid confusion
  let code = "";
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += chars[bytes[i]! % chars.length];
  }
  return code;
}

/** Generate an opaque device token */
function generateDeviceToken(): string {
  return `dpt_${crypto.randomBytes(32).toString("hex")}`;
}

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const HEARTBEAT_TIMEOUT_MS = 30 * 1000; // 30 seconds — device is offline if no heartbeat

// ---------------------------------------------------------------------------
// Helper: resolve device from token (used by device-auth endpoints)
// ---------------------------------------------------------------------------

async function resolveDevice(db: TRPCContext["db"], token: string) {
  const device = await db.query.dispatchDevice.findFirst({
    where: (d, { eq: eq_ }) => eq_(d.token, token),
  });
  if (!device) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid device token" });
  }
  if (!device.userId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Device not yet paired" });
  }
  return device;
}

export const dispatchRouter = createTRPCRouter({
  // ---- Device Registration (desktop, unauthenticated) ----------------------

  /**
   * Desktop calls this on startup to register itself and get a pairing code.
   * Returns: { deviceId, token, pairingCode, expiresAt }
   */
  registerDevice: publicProcedure
    .input(registerDeviceInput)
    .mutation(async ({ ctx, input }) => {
      const token = generateDeviceToken();
      const pairingCode = generatePairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

      const [device] = await ctx.db
        .insert(dispatchDevice)
        .values({
          name: input.name,
          token,
          pairingCode,
          pairingExpiresAt: expiresAt,
          isOnline: true,
          lastHeartbeatAt: new Date(),
        })
        .returning();

      return {
        deviceId: device!.id,
        token,
        pairingCode,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  // ---- Refresh Pairing Code (desktop, device-token) ------------------------

  /**
   * Desktop can request a new pairing code if the previous one expired.
   */
  refreshPairingCode: publicProcedure
    .input(heartbeatInput)
    .mutation(async ({ ctx, input }) => {
      const device = await ctx.db.query.dispatchDevice.findFirst({
        where: (d, { eq: eq_ }) => eq_(d.token, input.deviceToken),
      });
      if (!device) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid device token" });
      }

      const pairingCode = generatePairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

      await ctx.db
        .update(dispatchDevice)
        .set({ pairingCode, pairingExpiresAt: expiresAt })
        .where(eq(dispatchDevice.id, device.id));

      return { pairingCode, expiresAt: expiresAt.toISOString() };
    }),

  // ---- Pair Device (mobile, authenticated) ---------------------------------

  /**
   * Mobile user enters the 6-char code shown on the desktop.
   * Links the device to the authenticated user.
   */
  pair: protectedProcedure
    .input(pairDeviceInput)
    .mutation(async ({ ctx, input }) => {
      const device = await ctx.db.query.dispatchDevice.findFirst({
        where: (d, { eq: eq_ }) => eq_(d.pairingCode, input.code.toUpperCase()),
      });

      if (!device) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Invalid pairing code" });
      }

      if (device.pairingExpiresAt && device.pairingExpiresAt < new Date()) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Pairing code expired" });
      }

      if (device.userId && device.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Device already paired to another user",
        });
      }

      await ctx.db
        .update(dispatchDevice)
        .set({
          userId: ctx.session.user.id,
          pairingCode: null,
          pairingExpiresAt: null,
        })
        .where(eq(dispatchDevice.id, device.id));

      return {
        deviceId: device.id,
        name: device.name,
      };
    }),

  // ---- List Devices (mobile, authenticated) --------------------------------

  listDevices: protectedProcedure.query(async ({ ctx }) => {
    const devices = await ctx.db.query.dispatchDevice.findMany({
      where: (d, { eq: eq_ }) => eq_(d.userId, ctx.session.user.id),
    });

    const now = Date.now();
    return {
      devices: devices.map((d) => ({
        id: d.id,
        name: d.name,
        isOnline:
          d.isOnline &&
          d.lastHeartbeatAt !== null &&
          now - d.lastHeartbeatAt.getTime() < HEARTBEAT_TIMEOUT_MS,
        lastHeartbeatAt: d.lastHeartbeatAt?.toISOString() ?? null,
      })),
    };
  }),

  // ---- Heartbeat (desktop, device-token) -----------------------------------

  heartbeat: publicProcedure
    .input(heartbeatInput)
    .mutation(async ({ ctx, input }) => {
      const device = await ctx.db.query.dispatchDevice.findFirst({
        where: (d, { eq: eq_ }) => eq_(d.token, input.deviceToken),
      });
      if (!device) {
        throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid device token" });
      }

      await ctx.db
        .update(dispatchDevice)
        .set({
          isOnline: true,
          lastHeartbeatAt: new Date(),
        })
        .where(eq(dispatchDevice.id, device.id));

      return { ok: true };
    }),

  // ---- Send Message (mobile → desktop) -------------------------------------

  sendMessage: protectedProcedure
    .input(sendMessageInput)
    .mutation(async ({ ctx, input }) => {
      // Verify the device belongs to this user
      const device = await ctx.db.query.dispatchDevice.findFirst({
        where: (d, { eq: eq_ }) => eq_(d.id, input.deviceId),
      });

      if (!device || device.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      }

      const [message] = await ctx.db
        .insert(dispatchMessage)
        .values({
          deviceId: input.deviceId,
          direction: "to_device",
          type: input.type,
          payload: input.payload,
        })
        .returning();

      return { messageId: message!.id };
    }),

  // ---- Poll Messages (desktop polls for pending to_device messages) --------

  pollMessages: publicProcedure
    .input(pollMessagesInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDevice(ctx.db, input.deviceToken);

      const messages = await ctx.db.query.dispatchMessage.findMany({
        where: (m, { eq: eq_, and: and_ }) =>
          and_(
            eq_(m.deviceId, device.id),
            eq_(m.direction, "to_device"),
            eq_(m.status, "pending"),
          ),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });

      // Mark as delivered
      if (messages.length > 0) {
        for (const msg of messages) {
          await ctx.db
            .update(dispatchMessage)
            .set({ status: "delivered" })
            .where(eq(dispatchMessage.id, msg.id));
        }
      }

      return {
        messages: messages.map((m) => ({
          id: m.id,
          type: m.type,
          payload: m.payload,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }),

  // ---- Respond (desktop → mobile) ------------------------------------------

  respond: publicProcedure
    .input(respondInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDevice(ctx.db, input.deviceToken);

      const [message] = await ctx.db
        .insert(dispatchMessage)
        .values({
          deviceId: device.id,
          direction: "to_mobile",
          type: input.type,
          payload: input.payload,
        })
        .returning();

      return { messageId: message!.id };
    }),

  // ---- Poll Responses (mobile polls for to_mobile messages) ----------------

  pollResponses: protectedProcedure
    .input(pollResponsesInput)
    .mutation(async ({ ctx, input }) => {
      // Verify the device belongs to this user
      const device = await ctx.db.query.dispatchDevice.findFirst({
        where: (d, { eq: eq_ }) => eq_(d.id, input.deviceId),
      });

      if (!device || device.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      }

      const messages = await ctx.db.query.dispatchMessage.findMany({
        where: (m, { eq: eq_, and: and_ }) =>
          and_(
            eq_(m.deviceId, input.deviceId),
            eq_(m.direction, "to_mobile"),
            eq_(m.status, "pending"),
          ),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });

      if (messages.length > 0) {
        for (const msg of messages) {
          await ctx.db
            .update(dispatchMessage)
            .set({ status: "delivered" })
            .where(eq(dispatchMessage.id, msg.id));
        }
      }

      return {
        messages: messages.map((m) => ({
          id: m.id,
          type: m.type,
          payload: m.payload,
          createdAt: m.createdAt.toISOString(),
        })),
      };
    }),

  // ---- Unpair Device (mobile, authenticated) -------------------------------

  unpairDevice: protectedProcedure
    .input(pollResponsesInput) // reuses { deviceId }
    .mutation(async ({ ctx, input }) => {
      const device = await ctx.db.query.dispatchDevice.findFirst({
        where: (d, { eq: eq_ }) => eq_(d.id, input.deviceId),
      });

      if (!device || device.userId !== ctx.session.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Device not found" });
      }

      // Delete all messages and the device itself (cascade handles messages)
      await ctx.db.delete(dispatchDevice).where(eq(dispatchDevice.id, device.id));

      return { ok: true };
    }),
});
