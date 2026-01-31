import { handleRequest, type Env } from "./router";

export type { Env };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
