import { NlahError } from "./errors";

export type GraphNode = {
  state: string;
};

export type GraphEdge = {
  stage: string;
  from: string;
  to: string;
};

export function buildAdjacency(edges: GraphEdge[]): Record<string, GraphEdge[]> {
  const adjacency: Record<string, GraphEdge[]> = {};
  for (const edge of edges) {
    adjacency[edge.from] ??= [];
    adjacency[edge.from].push(edge);
    adjacency[edge.to] ??= [];
  }
  return adjacency;
}

export function buildReverseAdjacency(edges: GraphEdge[]): Record<string, GraphEdge[]> {
  const reverse: Record<string, GraphEdge[]> = {};
  for (const edge of edges) {
    reverse[edge.to] ??= [];
    reverse[edge.to].push(edge);
    reverse[edge.from] ??= [];
  }
  return reverse;
}

export function findStartStates(edges: GraphEdge[]): string[] {
  const fromStates = new Set(edges.map((edge) => edge.from));
  const toStates = new Set(edges.map((edge) => edge.to));
  return [...fromStates].filter((state) => !toStates.has(state)).sort();
}

export function traverseForward(edges: GraphEdge[], startState: string): GraphEdge[] {
  const adjacency = buildAdjacency(edges);
  const visitedStages = new Set<string>();
  const ordered: GraphEdge[] = [];
  const queue = [startState];
  const visitedStates = new Set<string>();

  while (queue.length > 0) {
    const state = queue.shift()!;
    if (visitedStates.has(state)) {
      continue;
    }
    visitedStates.add(state);

    for (const edge of adjacency[state] ?? []) {
      if (!visitedStages.has(edge.stage)) {
        visitedStages.add(edge.stage);
        ordered.push(edge);
      }
      queue.push(edge.to);
    }
  }

  return ordered;
}

export function detectCycles(edges: GraphEdge[]): string[][] {
  const adjacency = buildAdjacency(edges);
  const cycles: string[][] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(state: string): void {
    if (visiting.has(state)) {
      const start = stack.indexOf(state);
      cycles.push(stack.slice(start).concat(state));
      return;
    }
    if (visited.has(state)) {
      return;
    }

    visiting.add(state);
    stack.push(state);
    for (const edge of adjacency[state] ?? []) {
      visit(edge.to);
    }
    stack.pop();
    visiting.delete(state);
    visited.add(state);
  }

  for (const state of Object.keys(adjacency).sort()) {
    visit(state);
  }

  return cycles;
}

export function assertAcyclic(edges: GraphEdge[]): void {
  const cycles = detectCycles(edges);
  if (cycles.length > 0) {
    throw new NlahError(`graph cycles require explicit loop semantics: ${cycles[0].join(" -> ")}`);
  }
}
