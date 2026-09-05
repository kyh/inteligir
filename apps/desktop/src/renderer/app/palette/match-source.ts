import type {
  KnowledgeMatchesRequest,
  KnowledgeMatchesResponse,
} from "@repo/api/local/knowledge/knowledge-schema";

export type MatchSource = (
  request: KnowledgeMatchesRequest,
  signal: AbortSignal,
) => Promise<KnowledgeMatchesResponse>;

export interface MatchApi {
  knowledge: {
    matches(
      request: KnowledgeMatchesRequest,
      options: { signal: AbortSignal },
    ): Promise<KnowledgeMatchesResponse>;
  };
}

export function createMatchSource(api: MatchApi): MatchSource {
  return (request, signal) => api.knowledge.matches(request, { signal });
}
