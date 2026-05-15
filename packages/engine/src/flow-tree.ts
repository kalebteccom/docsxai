// Visualise the `extends` graph across a workspace's flow-files; report step-id collisions
// across the merged step list. Pure-static — no Playwright, no live page. Run via `site-docs flow-tree`.

import type { FlowFile } from "./doc-pack.js";
import { resolveFlowExtends } from "./flow-file.js";

export type FlowTreeNode = {
  name: string;
  steps: number;
  children: FlowTreeNode[];
};

export type FlowTreeIssue = {
  flow: string;
  message: string;
};

export type FlowTreeResult = {
  roots: FlowTreeNode[];
  /** Flows whose `extends` target isn't in the workspace. Listed separately so they're visible. */
  orphans: FlowTreeNode[];
  /** Resolution-time errors (cycles, step-id collisions across the merge, missing extends targets). */
  issues: FlowTreeIssue[];
};

export async function buildFlowTree(flowsByName: Map<string, FlowFile>): Promise<FlowTreeResult> {
  const childrenOf = new Map<string, string[]>();
  const orphanNames: string[] = [];
  const rootNames: string[] = [];

  for (const [name, flow] of flowsByName) {
    if (!flow.extends) {
      rootNames.push(name);
    } else if (!flowsByName.has(flow.extends)) {
      orphanNames.push(name);
    } else {
      const list = childrenOf.get(flow.extends) ?? [];
      list.push(name);
      childrenOf.set(flow.extends, list);
    }
  }

  const build = (name: string): FlowTreeNode => {
    const flow = flowsByName.get(name)!;
    const kids = (childrenOf.get(name) ?? []).slice().sort().map(build);
    return { name, steps: flow.steps.length, children: kids };
  };

  const issues: FlowTreeIssue[] = [];
  const loadFlow = async (n: string): Promise<FlowFile> => {
    const f = flowsByName.get(n);
    if (!f) throw new Error(`extends target not found: ${n}`);
    return f;
  };
  for (const [name, flow] of flowsByName) {
    if (!flow.extends || orphanNames.includes(name)) continue;
    try {
      await resolveFlowExtends(flow, loadFlow);
    } catch (e) {
      issues.push({ flow: name, message: (e as Error).message });
    }
  }

  return {
    roots: rootNames.slice().sort().map(build),
    orphans: orphanNames.slice().sort().map(build),
    issues,
  };
}

export function formatTreeText(result: FlowTreeResult): string {
  let out = "";
  for (const root of result.roots) {
    out += renderRoot(root);
    out += "\n";
  }
  if (result.orphans.length) {
    out += "(extends parent not in workspace — orphan flows)\n";
    for (const o of result.orphans) out += renderRoot(o);
    out += "\n";
  }

  const total = countTotal(result);
  const maxDepth = Math.max(0, ...result.roots.map(depth), ...result.orphans.map(depth));
  out += `${total} flow${total !== 1 ? "s" : ""}, max chain depth ${maxDepth}\n`;

  if (result.issues.length) {
    out += "\nissues:\n";
    for (const i of result.issues) out += `  ${i.flow}: ${i.message}\n`;
  }
  return out;
}

function renderRoot(node: FlowTreeNode): string {
  let out = `${node.name}    [${node.steps} step${node.steps !== 1 ? "s" : ""}]\n`;
  for (let i = 0; i < node.children.length; i++) {
    out += renderChild(node.children[i]!, "", i === node.children.length - 1);
  }
  return out;
}

function renderChild(node: FlowTreeNode, parentPrefix: string, isLast: boolean): string {
  const connector = isLast ? "└── " : "├── ";
  let out = `${parentPrefix}${connector}${node.name}    [+${node.steps} step${node.steps !== 1 ? "s" : ""}]\n`;
  const childPrefix = parentPrefix + (isLast ? "    " : "│   ");
  for (let i = 0; i < node.children.length; i++) {
    out += renderChild(node.children[i]!, childPrefix, i === node.children.length - 1);
  }
  return out;
}

function countTotal(result: FlowTreeResult): number {
  let n = 0;
  const walk = (node: FlowTreeNode): void => {
    n++;
    for (const c of node.children) walk(c);
  };
  for (const r of result.roots) walk(r);
  for (const o of result.orphans) walk(o);
  return n;
}

function depth(node: FlowTreeNode): number {
  if (node.children.length === 0) return 1;
  return 1 + Math.max(...node.children.map(depth));
}
