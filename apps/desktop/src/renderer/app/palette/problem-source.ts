import type {
  KnowledgeProblemsRequest,
  KnowledgeProblemsResponse,
} from "@repo/api/local/knowledge/knowledge-schema";

export type ProblemSource = (
  request: KnowledgeProblemsRequest,
  signal: AbortSignal,
) => Promise<KnowledgeProblemsResponse>;

export interface ProblemApi {
  knowledge: {
    problems(
      request: KnowledgeProblemsRequest,
      options: { signal: AbortSignal },
    ): Promise<KnowledgeProblemsResponse>;
  };
}

export function createProblemSource(api: ProblemApi): ProblemSource {
  return (request, signal) => api.knowledge.problems(request, { signal });
}
