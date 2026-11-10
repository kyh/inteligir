// What one run owns from its first start to its teardown: a scenario's in the runner, and the lone
// Worker's `serve-worker` boots. Every process, browser and link it starts is stopped at close, the
// last started first. A scenario abandoned at its deadline keeps going, and what it starts or says
// once the teardown began belongs to nothing: a start is stopped and refused, and a line is refused
// rather than printed under the next scenario's header, or into a buffer already flushed.

import type { TrackedProcess } from "./tracked-child";

type Scope =
  | { readonly kind: "open"; readonly instances: readonly TrackedProcess[] }
  | { readonly kind: "closing"; readonly verdict: Promise<boolean> }
  | { readonly kind: "closed"; readonly clean: boolean };

type ScopeEvent =
  | { readonly kind: "owned"; readonly instance: TrackedProcess }
  | { readonly kind: "closing"; readonly verdict: Promise<boolean> }
  | { readonly kind: "closed"; readonly clean: boolean };

const scopeAfter = (scope: Scope, event: ScopeEvent): Scope => {
  switch (event.kind) {
    case "owned": {
      return scope.kind === "open"
        ? { instances: [...scope.instances, event.instance], kind: "open" }
        : scope;
    }
    case "closing": {
      return scope.kind === "open" ? { kind: "closing", verdict: event.verdict } : scope;
    }
    case "closed": {
      return scope.kind === "closing" ? { clean: event.clean, kind: "closed" } : scope;
    }
    // no default
  }
};

export interface RunScope {
  // takes a started process, browser or link, to stop at close
  readonly own: (instance: TrackedProcess) => void;
  readonly log: (message: string) => void;
  // what each instance it owns last wrote, for a failure's report
  readonly tails: () => string;
  // stops every instance it owns, the last started first: true when each stopped, and the same
  // answer however often it is asked
  readonly close: () => Promise<boolean>;
}

export interface ScopeOutput {
  readonly out: (message: string) => void;
  // a stop that failed, which leaves a process that may still write into the scratch
  readonly err: (message: string) => void;
}

export const openScope = (output: ScopeOutput): RunScope => {
  let scope: Scope = { instances: [], kind: "open" };
  const stopped = async (instance: TrackedProcess): Promise<boolean> => {
    try {
      await instance.stop();
      return true;
    } catch (error) {
      output.err(`teardown: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  const stopEach = async (instances: readonly TrackedProcess[]): Promise<boolean> => {
    let clean = true;
    for (const instance of instances.toReversed()) {
      clean = (await stopped(instance)) && clean;
    }
    return clean;
  };
  return {
    close: async () => {
      switch (scope.kind) {
        case "open": {
          const verdict = stopEach(scope.instances);
          scope = scopeAfter(scope, { kind: "closing", verdict });
          const clean = await verdict;
          scope = scopeAfter(scope, { clean, kind: "closed" });
          return clean;
        }
        case "closing": {
          return await scope.verdict;
        }
        case "closed": {
          return scope.clean;
        }
        // no default
      }
    },
    log: (message) => {
      if (scope.kind !== "open") {
        throw new Error(`"${message}" said after the teardown began`);
      }
      output.out(message);
    },
    own: (instance) => {
      if (scope.kind === "open") {
        scope = scopeAfter(scope, { instance, kind: "owned" });
        return;
      }
      void stopped(instance);
      throw new Error(`${instance.name} started after the teardown began`);
    },
    tails: () => {
      if (scope.kind !== "open") {
        return "";
      }
      return scope.instances
        .map((instance) => {
          const tail = instance.outputTail();
          return tail.length === 0
            ? ""
            : `--- instance "${instance.name}" output tail ---\n${tail}`;
        })
        .filter((tail) => tail.length > 0)
        .join("\n");
    },
  };
};
