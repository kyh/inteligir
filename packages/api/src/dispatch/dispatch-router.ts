import crypto from "node:crypto";
import { eq, inArray } from "@repo/db";
import {
  dispatchDevice,
  dispatchMessage,
} from "@repo/db/drizzle-schema";
import { TRPCError } from "@trpc/server";

import type { TRPCContext } from "../trpc";
import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  catchUpInput,
  deviceTokenInput,
  mobileCatchUpInput,
  pairDeviceInput,
  registerDeviceInput,
  respondInput,
  sendMessageInput,
} from "./dispatch-schema";
import { broadcastDispatchEvent } from "./supabase-admin";

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

/** Generate an opaque token */
function generateToken(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(32).toString("hex")}`;
}

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ---------------------------------------------------------------------------
// Helpers: resolve device from token
// ---------------------------------------------------------------------------

async function resolveDeviceByToken(db: TRPCContext["db"], token: string) {
  const device = await db.query.dispatchDevice.findFirst({
    where: (d, { eq: eq_ }) => eq_(d.token, token),
  });
  if (!device) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid device token" });
  }
  return device;
}

/** Cache token → deviceId to avoid DB lookup on every streaming event */
const tokenDeviceCache = new Map<string, string>();

const EPHEMERAL_EVENT_TYPES = new Set(["message_update", "message_start"]);

async function resolveDeviceByMobileToken(db: TRPCContext["db"], mobileToken: string) {
  const device = await db.query.dispatchDevice.findFirst({
    where: (d, { eq: eq_ }) => eq_(d.mobileToken, mobileToken),
  });
  if (!device) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid mobile token" });
  }
  return device;
}

export const dispatchRouter = createTRPCRouter({
  // ---- Device Registration (desktop) ---------------------------------------

  registerDevice: publicProcedure
    .input(registerDeviceInput)
    .mutation(async ({ ctx, input }) => {
      const token = generateToken("dpt");
      const pairingCode = generatePairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

      const [device] = await ctx.db
        .insert(dispatchDevice)
        .values({
          name: input.name,
          token,
          pairingCode,
          pairingExpiresAt: expiresAt,
        })
        .returning();

      return {
        deviceId: device!.id,
        token,
        pairingCode,
        expiresAt: expiresAt.toISOString(),
      };
    }),

  // ---- Refresh Pairing Code (desktop) --------------------------------------

  refreshPairingCode: publicProcedure
    .input(deviceTokenInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDeviceByToken(ctx.db, input.deviceToken);

      const pairingCode = generatePairingCode();
      const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);

      await ctx.db
        .update(dispatchDevice)
        .set({ pairingCode, pairingExpiresAt: expiresAt })
        .where(eq(dispatchDevice.id, device.id));

      return { pairingCode, expiresAt: expiresAt.toISOString() };
    }),

  // ---- Pair Device (mobile — pairing code is the auth) ---------------------

  pair: publicProcedure
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

      const mobileToken = generateToken("dpm");

      await ctx.db
        .update(dispatchDevice)
        .set({
          mobileToken,
          pairingCode: null,
          pairingExpiresAt: null,
        })
        .where(eq(dispatchDevice.id, device.id));

      // Notify the desktop that pairing is complete
      await broadcastDispatchEvent(device.id, "device_paired", {
        deviceId: device.id,
      });

      return {
        deviceId: device.id,
        name: device.name,
        mobileToken,
      };
    }),

  // ---- Send Message (mobile → desktop) -------------------------------------

  sendMessage: publicProcedure
    .input(sendMessageInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDeviceByMobileToken(ctx.db, input.mobileToken);

      const [message] = await ctx.db
        .insert(dispatchMessage)
        .values({
          deviceId: device.id,
          direction: "to_device",
          type: input.type,
          payload: input.payload,
        })
        .returning();

      // Broadcast to desktop via Supabase Realtime
      await broadcastDispatchEvent(device.id, "dispatch_message", {
        id: message!.id,
        direction: "to_device",
        type: input.type,
        payload: input.payload,
        createdAt: message!.createdAt.toISOString(),
      });

      return { messageId: message!.id };
    }),

  // ---- Respond (desktop → mobile) ------------------------------------------

  respond: publicProcedure
    .input(respondInput)
    .mutation(async ({ ctx, input }) => {
      const isEphemeral = EPHEMERAL_EVENT_TYPES.has(input.type);

      // Use cached device ID for ephemeral events to skip DB lookup
      let deviceId = tokenDeviceCache.get(input.deviceToken);
      if (!deviceId) {
        const device = await resolveDeviceByToken(ctx.db, input.deviceToken);
        deviceId = device.id;
        tokenDeviceCache.set(input.deviceToken, deviceId);
      }

      let messageId: string | null = null;

      if (!isEphemeral) {
        const [message] = await ctx.db
          .insert(dispatchMessage)
          .values({
            deviceId,
            direction: "to_mobile",
            type: input.type,
            payload: input.payload,
          })
          .returning();
        messageId = message!.id;
      }

      await broadcastDispatchEvent(deviceId, "dispatch_message", {
        id: messageId,
        direction: "to_mobile",
        type: input.type,
        payload: input.payload,
        createdAt: new Date().toISOString(),
      });

      return { messageId };
    }),

  // ---- Catch-up (desktop fetches pending to_device on reconnect) -----------

  catchUp: publicProcedure
    .input(catchUpInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDeviceByToken(ctx.db, input.deviceToken);

      const messages = await ctx.db.query.dispatchMessage.findMany({
        where: (m, { eq: eq_, and: and_ }) =>
          and_(
            eq_(m.deviceId, device.id),
            eq_(m.direction, "to_device"),
            eq_(m.status, "pending"),
          ),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });

      // Batch mark as delivered in a single query
      if (messages.length > 0) {
        await ctx.db
          .update(dispatchMessage)
          .set({ status: "delivered" })
          .where(inArray(dispatchMessage.id, messages.map((m) => m.id)));
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

  // ---- Catch-up (mobile fetches pending to_mobile on reconnect) ------------

  mobileCatchUp: publicProcedure
    .input(mobileCatchUpInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDeviceByMobileToken(ctx.db, input.mobileToken);

      const messages = await ctx.db.query.dispatchMessage.findMany({
        where: (m, { eq: eq_, and: and_ }) =>
          and_(
            eq_(m.deviceId, device.id),
            eq_(m.direction, "to_mobile"),
            eq_(m.status, "pending"),
          ),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });

      // Batch mark as delivered in a single query
      if (messages.length > 0) {
        await ctx.db
          .update(dispatchMessage)
          .set({ status: "delivered" })
          .where(inArray(dispatchMessage.id, messages.map((m) => m.id)));
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

  // ---- Unpair Device -------------------------------------------------------

  unpairDevice: publicProcedure
    .input(deviceTokenInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDeviceByToken(ctx.db, input.deviceToken);
      tokenDeviceCache.delete(input.deviceToken);
      await ctx.db.delete(dispatchDevice).where(eq(dispatchDevice.id, device.id));
      return { ok: true };
    }),
});
