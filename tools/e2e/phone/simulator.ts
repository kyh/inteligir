import { spawn } from "node:child_process";
import { once } from "node:events";
import { access } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const NAME = "Inteligir e2e";
const DEVICE_TYPE = "com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro";
const APP = path.resolve(import.meta.dirname, "../../../apps/mobile/.simulator/Inteligir.app");
const BUNDLE_ID = "com.inteligir.mobile";

const MAESTRO_ENV = {
  MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
  MAESTRO_CLI_NO_ANALYTICS: "true",
  MAESTRO_DISABLE_UPDATE_CHECK: "true",
};

const Devices = z.object({
  devices: z.record(
    z.string(),
    z.array(z.object({ name: z.string(), state: z.string(), udid: z.string() })),
  ),
});

export const buildCloudPort = () => {
  const port = z
    .url({ protocol: /^http$/u })
    .transform((url) => new URL(url).port)
    .pipe(z.coerce.number<string>().int().positive())
    .safeParse(process.env.EXPO_PUBLIC_CLOUD_URL);

  if (!port.success) {
    throw new Error("EXPO_PUBLIC_CLOUD_URL names the phone build's cloud: run `pnpm e2e:mobile`");
  }

  return port.data;
};

interface Phone {
  readonly run: (flow: string, params: Readonly<Record<string, string>>) => Promise<void>;
  readonly close: () => Promise<void>;
}

const exec = async (
  command: string,
  args: readonly string[],
  { env = process.env, shown = false }: { env?: NodeJS.ProcessEnv; shown?: boolean } = {},
) => {
  const child = spawn(command, args, {
    env,
    stdio: ["ignore", shown ? "inherit" : "pipe", "inherit"],
  });

  let output = "";
  child.stdout?.setEncoding("utf-8").on("data", (chunk: string) => {
    output += chunk;
  });
  await once(child, "exit");

  if (child.exitCode !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited ${String(child.exitCode)}`);
  }

  return output.trim();
};

const simctl = async (...args: string[]) => await exec("xcrun", ["simctl", ...args]);

const findOrCreate = async () => {
  const { devices } = Devices.parse(
    JSON.parse(await simctl("list", "devices", "available", "--json")),
  );

  const found = Object.values(devices)
    .flat()
    .find((device) => device.name === NAME);

  if (found !== undefined) {
    return { booted: found.state === "Booted", udid: found.udid } satisfies {
      udid: string;
      booted: boolean;
    };
  }

  return { booted: false, udid: await simctl("create", NAME, DEVICE_TYPE) } satisfies {
    udid: string;
    booted: boolean;
  };
};

export const openPhone = async () => {
  try {
    await access(APP);
  } catch {
    throw new Error(`no build at ${APP}: \`pnpm e2e:mobile\` makes it first`);
  }

  const { booted, udid } = await findOrCreate();
  await simctl("bootstatus", udid, "-b");
  await simctl("install", udid, APP);

  return {
    close: async () => {
      await simctl("terminate", udid, BUNDLE_ID).catch(() => "not running");

      if (!booted) {
        await simctl("shutdown", udid);
      }
    },
    run: async (flow, params) => {
      const defined = Object.entries(params).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
      await exec("maestro", ["--udid", udid, "test", ...defined, flow], {
        env: { ...process.env, ...MAESTRO_ENV },
        shown: true,
      });
    },
  } satisfies Phone;
};
