/// <reference types="@cloudflare/workers-types" />

type Env = import('./functions/_lib/holodock').Env;

declare global {
  // Pages Functions ambient
  type PagesFunction<
    Env = unknown,
    P extends string = string,
    Data extends Record<string, unknown> = Record<string, unknown>,
  > = (context: EventContext<Env, P, Data>) => Response | Promise<Response>;
}

export {};
