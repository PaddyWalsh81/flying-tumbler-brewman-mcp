import axios, { AxiosError } from "axios";

/**
 * Shared Brewman Web API client.
 *
 * All Brewman endpoints are POST under `${BASE}/webapi/<Resource>/v1|v2/<Method>`,
 * authenticated with an `Api-Token` header. Most methods also require a tenant
 * (group) id in the JSON body. Secrets come ONLY from environment variables —
 * never hard-coded, never logged.
 */

export const BASE_URL =
  process.env.BREWMAN_BASE_URL?.replace(/\/$/, "") ||
  "https://brewman.premiersystems.com";

/** The body key under which the tenant/group id is sent. Beta API: most methods
 * use the same key but it is documented per-method, so it's overridable. */
const TENANT_FIELD = process.env.BREWMAN_TENANT_FIELD || "groupId";

export const CHARACTER_LIMIT = 25000;

function requireToken(): string {
  const token = process.env.BREWMAN_API_TOKEN;
  if (!token) {
    throw new Error(
      "BREWMAN_API_TOKEN is not set. Configure it as a server environment variable (see README)."
    );
  }
  return token;
}

/**
 * Call a Brewman Web API method.
 * @param methodPath e.g. "/webapi/Order/v2/GetOrdersByFilter"
 * @param body request payload; the tenant id is merged in automatically unless
 *             already present in the body.
 */
export async function callBrewman<T = unknown>(
  methodPath: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const token = requireToken();
  const tenant = process.env.BREWMAN_TENANT_ID;

  const payload: Record<string, unknown> = { ...body };
  if (tenant && !(TENANT_FIELD in payload)) {
    payload[TENANT_FIELD] = tenant;
  }

  const url = methodPath.startsWith("http")
    ? methodPath
    : `${BASE_URL}${methodPath.startsWith("/") ? "" : "/"}${methodPath}`;

  const res = await axios.post(url, payload, {
    timeout: 30000,
    headers: {
      "Api-Token": token,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
  });
  return res.data as T;
}

/** Turn any error into a clear, actionable message for the agent. */
export function handleApiError(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const ax = error as AxiosError;
    if (ax.response) {
      const status = ax.response.status;
      const detail =
        typeof ax.response.data === "string"
          ? ax.response.data.slice(0, 500)
          : JSON.stringify(ax.response.data)?.slice(0, 500);
      switch (status) {
        case 401:
          return "Error: Unauthorised (401). The Api-Token is missing, wrong, or revoked. Check BREWMAN_API_TOKEN.";
        case 403:
          return "Error: Forbidden (403). The API user lacks permission for this action, or the tenant id is wrong.";
        case 404:
          return `Error: Not found (404). Check the method path and any ids. ${detail ?? ""}`;
        case 429:
          return "Error: Rate limited (429). Wait and retry.";
        default:
          return `Error: Brewman API returned ${status}. ${detail ?? ""}`;
      }
    }
    if (ax.code === "ECONNABORTED") {
      return "Error: Brewman API request timed out (30s). Try again.";
    }
    return `Error: Network error calling Brewman API: ${ax.message}`;
  }
  return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

/** Format a tool result with both text and structured content, truncating if huge. */
export function toolResult(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  let truncated = false;
  if (text.length > CHARACTER_LIMIT) {
    truncated = true;
    text =
      text.slice(0, CHARACTER_LIMIT) +
      `\n\n... [truncated at ${CHARACTER_LIMIT} chars — narrow your filter or request fewer ids]`;
  }
  return {
    content: [{ type: "text" as const, text }],
    structuredContent:
      data && typeof data === "object" && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : { result: data, truncated },
  };
}
