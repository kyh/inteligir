import crypto from "node:crypto";
import { eq, inArray } from "@repo/db";
import {
  dispatchDevice,
  dispatchMessage,
} from "@repo/db/drizzle-schema";
import { db } from "@repo/db/drizzle-client";
import { TRPCError } from "@trpc/server";

import { createTRPCRouter, publicProcedure } from "../trpc";
import {
  catchUpInput,
  deviceTokenInput,
  mobileCatchUpInput,
  pairDeviceInput,
  registerDeviceInput,
  respondInput,
  sendMessageInput,
  subscribeDeviceInput,
  subscribeMobileInput,
} from "./dispatch-schema";

/** Generate a cryptographically random 6-char uppercase alphanumeric code */
function generatePairingCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
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
const POLL_INTERVAL_MS = 1000;

// ---------------------------------------------------------------------------
// Helpers: resolve device from token
// ---------------------------------------------------------------------------

async function resolveDeviceByToken(token: string) {
  const device = await db.query.dispatchDevice.findFirst({
    where: (d, { eq: eq_ }) => eq_(d.token, token),
  });
  if (!device) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid device token" });
  }
  return device;
}

async function resolveDeviceByMobileToken(mobileToken: string) {
  const device = await db.query.dispatchDevice.findFirst({
    where: (d, { eq: eq_ }) => eq_(d.mobileToken, mobileToken),
  });
  if (!device) {
    throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid mobile token" });
  }
  return device;
}

/** Cache token → deviceId to avoid DB lookup on every streaming event */
const tokenDeviceCache = (() => {
  const MAX = 10000;
  const cache = new Map<string, string>();
  return {
    get: (k: string) => cache.get(k),
    set: (k: string, v: string) => {
      cache.set(k, v);
      if (cache.size > MAX) {
        const oldest = cache.keys().next().value;
        if (oldest) cache.delete(oldest);
      }
    },
    delete: (k: string) => cache.delete(k),
  };
})();

// ---------------------------------------------------------------------------
// Helpers: poll for pending messages and yield them
// ---------------------------------------------------------------------------

async function* pollMessages(
  deviceId: string,
  direction: "to_device" | "to_mobile",
  signal: AbortSignal,
) {
  while (!signal.aborted) {
    const messages = await db.query.dispatchMessage.findMany({
      where: (m, { eq: eq_, and: and_ }) =>
        and_(
          eq_(m.deviceId, deviceId),
          eq_(m.direction, direction),
          eq_(m.status, "pending"),
        ),
      orderBy: (m, { asc }) => asc(m.createdAt),
    });

    if (messages.length > 0) {
      for (const msg of messages) {
        yield {
          id: msg.id,
          direction: msg.direction,
          type: msg.type,
          payload: msg.payload,
          createdAt: msg.createdAt.toISOString(),
        };
        await db
          .update(dispatchMessage)
          .set({ status: "delivered" })
          .where(eq(dispatchMessage.id, msg.id));
      }
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

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
      const device = await resolveDeviceByToken(input.deviceToken);

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

      // Insert a system message so the desktop subscription picks up the
      // pairing event naturally via the SSE stream.
      await ctx.db.insert(dispatchMessage).values({
        deviceId: device.id,
        direction: "to_device",
        type: "device_paired",
        payload: { deviceId: device.id },
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
      const device = await resolveDeviceByMobileToken(input.mobileToken);

      const [message] = await ctx.db
        .insert(dispatchMessage)
        .values({
          deviceId: device.id,
          direction: "to_device",
          type: input.type,
          payload: input.payload,
        })
        .returning();

      return { messageId: message!.id };
    }),

  // ---- Respond (desktop → mobile) ------------------------------------------

  respond: publicProcedure
    .input(respondInput)
    .mutation(async ({ ctx, input }) => {
      let deviceId = tokenDeviceCache.get(input.deviceToken);
      if (!deviceId) {
        const device = await resolveDeviceByToken(input.deviceToken);
        deviceId = device.id;
        tokenDeviceCache.set(input.deviceToken, deviceId);
      }

      const [message] = await ctx.db
        .insert(dispatchMessage)
        .values({
          deviceId,
          direction: "to_mobile",
          type: input.type,
          payload: input.payload,
        })
        .returning();

      return { messageId: message!.id };
    }),

  // ---- SSE Subscription (desktop listens for to_device messages) ----------

  subscribeDevice: publicProcedure
    .input(subscribeDeviceInput)
    .subscription(async function* ({ input, signal }) {
      if (!signal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Subscription requires an abort signal" });
      const device = await resolveDeviceByToken(input.deviceToken);
      yield* pollMessages(device.id, "to_device", signal);
    }),

  // ---- SSE Subscription (mobile listens for to_mobile messages) -----------

  subscribeMobile: publicProcedure
    .input(subscribeMobileInput)
    .subscription(async function* ({ input, signal }) {
      if (!signal) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Subscription requires an abort signal" });
      const device = await resolveDeviceByMobileToken(input.mobileToken);
      yield* pollMessages(device.id, "to_mobile", signal);
    }),

  // ---- Catch-up (desktop fetches pending to_device on reconnect) -----------

  catchUp: publicProcedure
    .input(catchUpInput)
    .mutation(async ({ ctx, input }) => {
      const device = await resolveDeviceByToken(input.deviceToken);

      const messages = await ctx.db.query.dispatchMessage.findMany({
        where: (m, { eq: eq_, and: and_ }) =>
          and_(
            eq_(m.deviceId, device.id),
            eq_(m.direction, "to_device"),
            eq_(m.status, "pending"),
          ),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });

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
      const device = await resolveDeviceByMobileToken(input.mobileToken);

      const messages = await ctx.db.query.dispatchMessage.findMany({
        where: (m, { eq: eq_, and: and_ }) =>
          and_(
            eq_(m.deviceId, device.id),
            eq_(m.direction, "to_mobile"),
            eq_(m.status, "pending"),
          ),
        orderBy: (m, { asc }) => asc(m.createdAt),
      });

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
      const device = await resolveDeviceByToken(input.deviceToken);
      tokenDeviceCache.delete(input.deviceToken);
      await ctx.db.delete(dispatchDevice).where(eq(dispatchDevice.id, device.id));
      return { ok: true };
    }),
});
