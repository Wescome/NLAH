import type { StageSpec } from "./schema.js";
import { CompilerError } from "./errors.js";

export type GraphEdge = {
  stageName: string;
  from: string;
  to: string;
};

export type StageGraph = {
  edges: GraphEdge[];
  states: Set<string>;
  outgoing: Map<string, GraphEdge[]>;
  incoming: Map<string, GraphEdge[]>;
};

export function buildStageGraph(stages: Record<string, StageSpec>): StageGraph {
  const edges: GraphEdge[] = Object.entries(stages).map(([stageName, spec]) => ({
    stageName,
    from: spec.from,
    to: spec.to
  }));
  const states = new Set<string>();
  const outgoing = new Map<string, GraphEdge[]>();
  const incoming = new Map<string, GraphEdge[]>();

  for (const edge of edges) {
    states.add(edge.from);
    states.add(edge.to);
    outgoing.set(edge.from, [...(outgoing.get(edge.from) ?? []), edge]);
    incoming.set(edge.to, [...(incoming.get(edge.to) ?? []), edge]);
    outgoing.set(edge.to, outgoing.get(edge.to) ?? []);
    incoming.set(edge.from, incoming.get(edge.from) ?? []);
  }

  for (const edgeList of outgoing.values()) {
    edgeList.sort((a, b) => a.stageName.localeCompare(b.stageName));
  }
  for (const edgeList of incoming.values()) {
    edgeList.sort((a, b) => a.stageName.localeCompare(b.stageName));
  }

  return { edges, states, outgoing, incoming };
}

export function findStartStates(graph: StageGraph): string[] {
  return [...graph.states]
    .filter((state) => (graph.outgoing.get(state)?.length ?? 0) > 0)
    .filter((state) => (graph.incoming.get(state)?.length ?? 0) === 0)
    .sort();
}

export function assertNoCycles(graph: StageGraph): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  function visit(state: string): void {
    if (visiting.has(state)) {
      const start = stack.indexOf(state);
      const cycle = stack.slice(Math.max(start, 0)).concat(state);
      throw new CompilerError(`graph cycles require explicit loop semantics: ${cycle.join(" -> ")}`);
    }
    if (visited.has(state)) {
      return;
    }

    visiting.add(state);
    stack.push(state);
    for (const edge of graph.outgoing.get(state) ?? []) {
      visit(edge.to);
    }
    stack.pop();
    visiting.delete(state);
    visited.add(state);
  }

  for (const state of [...graph.states].sort()) {
    visit(state);
  }
}

export function assertReachableFrom(graph: StageGraph, startState: string): void {
  const reachableStages = new Set<string>();
  const reachableStates = new Set<string>();
  const queue = [startState];

  while (queue.length > 0) {
    const state = queue.shift();
    if (!state || reachableStates.has(state)) {
      continue;
    }
    reachableStates.add(state);

    for (const edge of graph.outgoing.get(state) ?? []) {
      reachableStages.add(edge.stageName);
      queue.push(edge.to);
    }
  }

  const unreachable = graph.edges
    .map((edge) => edge.stageName)
    .filter((stageName) => !reachableStages.has(stageName));
  if (unreachable.length > 0) {
    throw new CompilerError(`unreachable stages: ${unreachable.join(", ")}`);
  }
}

export function deterministicStageOrder(
  stages: Record<string, StageSpec>,
  startState: string
): string[] {
  const graph = buildStageGraph(stages);
  const ordered: string[] = [];
  const visitedStages = new Set<string>();
  const queue = [startState];

  while (queue.length > 0) {
    const state = queue.shift();
    if (!state) {
      continue;
    }
    for (const edge of graph.outgoing.get(state) ?? []) {
      if (!visitedStages.has(edge.stageName)) {
        visitedStages.add(edge.stageName);
        ordered.push(edge.stageName);
        queue.push(edge.to);
      }
    }
  }

  return ordered;
}
