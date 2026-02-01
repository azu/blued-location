import { verifyBearerToken } from "./auth";
import { handlePostLocations } from "./handlers/post-locations";
import { handleGetLocations } from "./handlers/get-locations";

export type Env = {
  DB: D1Database;
  API_TOKEN: string;
  NOMINATIM_USER_AGENT?: string;
  NOMINATIM_EMAIL?: string;
};

function jsonErrorResponse(error: string, status: number): Response {
  return new Response(JSON.stringify({ result: "error", error }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleRequest(
  request: Request,
  env: Env
): Promise<Response> {
  const url = new URL(request.url);

  // API routes require authentication
  if (url.pathname.startsWith("/api/")) {
    const authResult = verifyBearerToken(request, env.API_TOKEN);
    if (!authResult.ok) {
      return jsonErrorResponse(authResult.error, 401);
    }
  }

  // Routing
  if (url.pathname === "/api/locations") {
    if (request.method === "POST") {
      return handlePostLocations(request, env);
    }
    if (request.method === "GET") {
      return handleGetLocations(request, env);
    }
    return new Response("Method Not Allowed", { status: 405 });
  }

  // Static assets will be handled by Cloudflare Assets
  return new Response("Not Found", { status: 404 });
}
