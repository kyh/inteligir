type Pass = { readonly kind: "idle" } | { readonly kind: "running"; readonly again: boolean };

const passAfter = (pass: Pass, event: "asked" | "finished" | "failed") => {
  switch (event) {
    case "asked": {
      return { again: pass.kind === "running", kind: "running" } satisfies Pass;
    }

    case "finished": {
      return (
        pass.kind === "running" && pass.again ? { again: false, kind: "running" } : { kind: "idle" }
      ) satisfies Pass;
    }

    case "failed": {
      return { kind: "idle" } satisfies Pass;
    }

    default: {
      throw new Error(`unexpected ${String(event satisfies never)}`);
    }
  }
};

export const oneAtATime = <A extends readonly unknown[]>(run: (...args: A) => Promise<void>) => {
  let pass: Pass = { kind: "idle" };
  let drained: Promise<void> = Promise.resolve();

  const drain = async (args: A) => {
    do {
      try {
        await run(...args);
      } catch (error) {
        pass = passAfter(pass, "failed");
        throw error;
      }

      pass = passAfter(pass, "finished");
    } while (pass.kind === "running");
  };

  return (async (...args) => {
    const starts = pass.kind === "idle";
    pass = passAfter(pass, "asked");

    if (starts) {
      drained = drain(args);
    }

    await drained;
  }) satisfies (...args: A) => Promise<void>;
};
