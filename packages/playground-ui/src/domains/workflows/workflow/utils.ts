import Dagre from '@dagrejs/dagre';
import { Workflow, SerializedStepFlowEntry } from '@mastra/core/workflows';
import type { Node, Edge } from '@xyflow/react';
import { MarkerType } from '@xyflow/react';

// Constants for group node layout
const NODE_WIDTH = 274;
const NODE_HEIGHT = 100;
const NODE_HEIGHT_LARGE = 260;
const GROUP_PADDING = 40;
const GROUP_HEADER_HEIGHT = 50;

const defaultEdgeOptions = {
  animated: true,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 20,
    height: 20,
    color: '#8e8e8e',
  },
};

interface ProcessContext {
  parentGroupId?: string; // The direct parent group ID (for parentId on nodes)
  idPrefix: string; // Prefix for node IDs (accumulated from all ancestor groups)
  stepPathPrefix: string; // Prefix for step paths (using dot notation for run context lookups)
}

/**
 * Unified recursive function to process a step graph at any nesting level
 */
function processStepGraph(
  stepGraph: SerializedStepFlowEntry[],
  context: ProcessContext,
): {
  nodes: Node[];
  edges: Edge[];
  firstNodeIds: string[];
  lastNodeIds: string[];
  firstStepPaths: string[];
  lastStepPaths: string[];
  width: number;
  height: number;
} {
  if (!stepGraph || stepGraph.length === 0) {
    return { nodes: [], edges: [], firstNodeIds: [], lastNodeIds: [], firstStepPaths: [], lastStepPaths: [], width: NODE_WIDTH, height: NODE_HEIGHT };
  }

  let nodes: Node[] = [];
  let edges: Edge[] = [];
  let prevNodeIds: string[] = [];
  let prevStepIds: string[] = [];
  let prevStepPaths: string[] = [];
  let allNodeIds: string[] = [];
  let firstNodeIds: string[] = [];
  let firstStepPaths: string[] = [];

  for (let i = 0; i < stepGraph.length; i++) {
    const stepFlow = stepGraph[i];
    const nextStepFlow = i < stepGraph.length - 1 ? stepGraph[i + 1] : undefined;

    const result = processStep({
      stepFlow,
      nextStepFlow,
      prevNodeIds,
      prevStepIds,
      prevStepPaths,
      allNodeIds,
      yIndex: i,
      context,
    });

    if (i === 0) {
      firstNodeIds = result.entryNodeIds;
      firstStepPaths = result.exitStepPaths;
    }

    nodes.push(...result.nodes);
    edges.push(...result.edges);
    prevNodeIds = result.exitNodeIds;
    prevStepIds = result.exitStepIds;
    prevStepPaths = result.exitStepPaths;
    allNodeIds.push(...result.nodes.map(n => n.id));
  }

  // Layout the nodes
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: 'TB', // Top to bottom
    nodesep: 50, // Horizontal spacing between nodes in same rank
    ranksep: 80, // Vertical spacing between ranks
  });

  // Only layout nodes that belong directly to this level (not nested children)
  const directNodes = nodes.filter(n => n.parentId === context.parentGroupId);
  const childNodes = nodes.filter(n => n.parentId !== context.parentGroupId);

  directNodes.forEach(node => {
    const nodeData = node.data as Record<string, unknown>;
    const width = (typeof nodeData?.width === 'number' ? nodeData.width : null) ?? NODE_WIDTH;
    const height =
      (typeof nodeData?.height === 'number' ? nodeData.height : null) ??
      (nodeData?.isLarge ? NODE_HEIGHT_LARGE : NODE_HEIGHT);
    g.setNode(node.id, { width, height });
  });

  // Build layout edges - need to handle edges that cross into groups
  const directNodeIds = new Set(directNodes.map(n => n.id));

  // Map child nodes to their direct parent group
  const nodeToParentGroup = new Map<string, string>();
  childNodes.forEach(child => {
    // Find the direct parent group at this level
    let parentId = child.parentId;
    while (parentId && !directNodeIds.has(parentId)) {
      const parentNode = nodes.find(n => n.id === parentId);
      parentId = parentNode?.parentId;
    }
    if (parentId) {
      nodeToParentGroup.set(child.id, parentId);
    }
  });

  // Add edges for layout, mapping child nodes to their parent groups
  edges.forEach(e => {
    const sourceId = directNodeIds.has(e.source) ? e.source : nodeToParentGroup.get(e.source);
    const targetId = directNodeIds.has(e.target) ? e.target : nodeToParentGroup.get(e.target);

    // Only add edge if both endpoints resolve to direct nodes and they're different
    if (sourceId && targetId && sourceId !== targetId) {
      g.setEdge(sourceId, targetId);
    }
  });

  Dagre.layout(g);

  const graphWidth = g.graph()?.width ?? NODE_WIDTH;
  const graphHeight = g.graph()?.height ?? NODE_HEIGHT;

  // Position direct nodes
  const positionedDirectNodes = directNodes.map(node => {
    const pos = g.node(node.id);
    const nodeData = node.data as Record<string, unknown>;
    const width = (typeof nodeData?.width === 'number' ? nodeData.width : null) ?? NODE_WIDTH;
    const height =
      (typeof nodeData?.height === 'number' ? nodeData.height : null) ??
      (nodeData?.isLarge ? NODE_HEIGHT_LARGE : NODE_HEIGHT);

    // If we're inside a group, offset for header and padding
    const offsetX = context.parentGroupId ? GROUP_PADDING : 0;
    const offsetY = context.parentGroupId ? GROUP_HEADER_HEIGHT + GROUP_PADDING : 0;

    return {
      ...node,
      position: {
        x: pos.x - width / 2 + offsetX,
        y: pos.y - height / 2 + offsetY,
      },
    };
  });

  // Calculate dimensions for group
  const totalWidth = graphWidth + (context.parentGroupId ? GROUP_PADDING * 2 : 0);
  const totalHeight = graphHeight + (context.parentGroupId ? GROUP_HEADER_HEIGHT + GROUP_PADDING * 2 : 0);

  return {
    nodes: [...positionedDirectNodes, ...childNodes],
    edges,
    firstNodeIds,
    lastNodeIds: prevNodeIds,
    firstStepPaths,
    lastStepPaths: prevStepPaths,
    width: Math.max(totalWidth, 300),
    height: Math.max(totalHeight, 150),
  };
}

/**
 * Process a single step entry
 */
function processStep({
  stepFlow,
  nextStepFlow,
  prevNodeIds,
  prevStepIds,
  prevStepPaths,
  allNodeIds,
  yIndex,
  context,
}: {
  stepFlow: SerializedStepFlowEntry;
  nextStepFlow?: SerializedStepFlowEntry;
  prevNodeIds: string[];
  prevStepIds: string[];
  prevStepPaths: string[];
  allNodeIds: string[];
  yIndex: number;
  context: ProcessContext;
}): {
  nodes: Node[];
  edges: Edge[];
  entryNodeIds: string[];
  exitNodeIds: string[];
  exitStepIds: string[];
  exitStepPaths: string[];
} {
  const makeNodeId = (id: string) => (context.idPrefix ? `${context.idPrefix}_${id}` : id);
  const makeStepPath = (id: string) => (context.stepPathPrefix ? `${context.stepPathPrefix}.${id}` : id);

  if (stepFlow.type === 'step' || stepFlow.type === 'foreach') {
    const hasNestedWorkflow = stepFlow.step.component === 'WORKFLOW' && stepFlow.step.serializedStepFlow;
    const baseNodeId = makeNodeId(stepFlow.step.id);
    const nodeId = allNodeIds.includes(baseNodeId) ? `${baseNodeId}-${yIndex}` : baseNodeId;
    const stepPath = makeStepPath(stepFlow.step.id);

    if (hasNestedWorkflow) {
      // Process nested workflow recursively
      const nestedResult = processStepGraph(stepFlow.step.serializedStepFlow!, {
        parentGroupId: nodeId,
        idPrefix: nodeId,
        stepPathPrefix: stepPath,
      });

      // Create group node
      const groupNode: Node = {
        id: nodeId,
        position: { x: 0, y: 0 },
        type: 'group-node',
        ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
        data: {
          label: stepFlow.step.id,
          stepId: stepFlow.step.id,
          stepPath,
          description: stepFlow.step.description,
          stepGraph: stepFlow.step.serializedStepFlow,
          canSuspend: stepFlow.step.canSuspend,
          isForEach: stepFlow.type === 'foreach',
          width: nestedResult.width,
          height: nestedResult.height,
        },
      };

      // Edges: prev → first inside, last inside → (handled by caller)
      const incomingEdges = prevNodeIds.flatMap((prevNodeId, i) =>
        nestedResult.firstNodeIds.map(firstNodeId => ({
          id: `e${prevNodeId}-${firstNodeId}`,
          source: prevNodeId,
          target: firstNodeId,
          data: {
            previousStepId: prevStepIds[i] || prevStepIds[0],
            nextStepId: stepFlow.step.id,
            previousStepPath: prevStepPaths[i] || prevStepPaths[0],
            nextStepPath: nestedResult.firstStepPaths?.[0] || stepPath,
          },
          zIndex: 1,
          ...defaultEdgeOptions,
        })),
      );

      return {
        nodes: [groupNode, ...nestedResult.nodes],
        edges: [...incomingEdges, ...nestedResult.edges],
        entryNodeIds: nestedResult.firstNodeIds,
        exitNodeIds: nestedResult.lastNodeIds,
        exitStepIds: [stepFlow.step.id],
        exitStepPaths: nestedResult.lastStepPaths || [stepPath],
      };
    }

    // Regular step node
    const node: Node = {
      id: nodeId,
      position: { x: 0, y: 0 },
      type: 'default-node',
      ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
      data: {
        label: stepFlow.step.id,
        stepId: stepFlow.step.id,
        stepPath,
        description: stepFlow.step.description,
        mapConfig: stepFlow.step.mapConfig,
        canSuspend: stepFlow.step.canSuspend,
        isForEach: stepFlow.type === 'foreach',
      },
    };

    const edges = prevNodeIds.map((prevNodeId, i) => ({
      id: `e${prevNodeId}-${nodeId}`,
      source: prevNodeId,
      target: nodeId,
      data: {
        previousStepId: prevStepIds[i],
        nextStepId: stepFlow.step.id,
        previousStepPath: prevStepPaths[i],
        nextStepPath: stepPath,
      },
      ...(context.parentGroupId && { zIndex: 1 }),
      ...defaultEdgeOptions,
    }));

    return {
      nodes: [node],
      edges,
      entryNodeIds: [nodeId],
      exitNodeIds: [nodeId],
      exitStepIds: [stepFlow.step.id],
      exitStepPaths: [stepPath],
    };
  }

  if (stepFlow.type === 'sleep' || stepFlow.type === 'sleepUntil') {
    const baseNodeId = makeNodeId(stepFlow.id);
    const nodeId = allNodeIds.includes(baseNodeId) ? `${baseNodeId}-${yIndex}` : baseNodeId;
    const stepPath = makeStepPath(stepFlow.id);

    const node: Node = {
      id: nodeId,
      position: { x: 0, y: 0 },
      type: 'default-node',
      ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
      data: {
        label: stepFlow.id,
        stepId: stepFlow.id,
        stepPath,
        ...(stepFlow.type === 'sleepUntil' ? { date: stepFlow.date } : { duration: stepFlow.duration }),
      },
    };

    const edges = prevNodeIds.map((prevNodeId, i) => ({
      id: `e${prevNodeId}-${nodeId}`,
      source: prevNodeId,
      target: nodeId,
      data: {
        previousStepId: prevStepIds[i],
        nextStepId: stepFlow.id,
        previousStepPath: prevStepPaths[i],
        nextStepPath: stepPath,
      },
      ...(context.parentGroupId && { zIndex: 1 }),
      ...defaultEdgeOptions,
    }));

    return {
      nodes: [node],
      edges,
      entryNodeIds: [nodeId],
      exitNodeIds: [nodeId],
      exitStepIds: [stepFlow.id],
      exitStepPaths: [stepPath],
    };
  }

  if (stepFlow.type === 'parallel') {
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let entryNodeIds: string[] = [];
    let exitNodeIds: string[] = [];
    let exitStepIds: string[] = [];
    let exitStepPaths: string[] = [];

    stepFlow.steps.forEach((parallelStep, idx) => {
      const result = processStep({
        stepFlow: parallelStep,
        nextStepFlow,
        prevNodeIds,
        prevStepIds,
        prevStepPaths,
        allNodeIds: [...allNodeIds, ...nodes.map(n => n.id)],
        yIndex,
        context,
      });

      // Mark as parallel
      const markedNodes = result.nodes.map(n => ({
        ...n,
        data: { ...n.data, isParallel: true },
      }));

      nodes.push(...markedNodes);
      edges.push(...result.edges);
      entryNodeIds.push(...result.entryNodeIds);
      exitNodeIds.push(...result.exitNodeIds);
      exitStepIds.push(...result.exitStepIds);
      exitStepPaths.push(...result.exitStepPaths);
    });

    return { nodes, edges, entryNodeIds, exitNodeIds, exitStepIds, exitStepPaths };
  }

  if (stepFlow.type === 'conditional') {
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let exitNodeIds: string[] = [];
    let exitStepIds: string[] = [];
    let exitStepPaths: string[] = [];

    stepFlow.steps.forEach((condStep, idx) => {
      const condition = stepFlow.serializedConditions[idx];
      const conditionNodeId = makeNodeId(condition.id);
      const conditionStepPath = makeStepPath(condition.id);

      // Condition node
      const conditionNode: Node = {
        id: conditionNodeId,
        position: { x: 0, y: 0 },
        type: 'condition-node',
        ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
        data: {
          label: condition.id,
          stepPath: conditionStepPath,
          previousStepId: prevStepIds[prevStepIds.length - 1],
          nextStepId: condStep.step.id,
          isLarge: true,
          conditions: [{ type: 'when', fnString: condition.fn }],
        },
      };
      nodes.push(conditionNode);

      // Edges from prev to condition
      edges.push(
        ...prevNodeIds.map((prevNodeId, i) => ({
          id: `e${prevNodeId}-${conditionNodeId}`,
          source: prevNodeId,
          target: conditionNodeId,
          data: {
            previousStepId: prevStepIds[i],
            nextStepId: condStep.step.id,
            previousStepPath: prevStepPaths[i],
            nextStepPath: conditionStepPath,
            conditionNode: true,
          },
          ...(context.parentGroupId && { zIndex: 1 }),
          ...defaultEdgeOptions,
        })),
      );

      // Process the step after condition
      const result = processStep({
        stepFlow: condStep,
        nextStepFlow: undefined,
        prevNodeIds: [conditionNodeId],
        prevStepIds: [condition.id],
        prevStepPaths: [conditionStepPath],
        allNodeIds: [...allNodeIds, ...nodes.map(n => n.id)],
        yIndex: yIndex + 1,
        context,
      });

      nodes.push(...result.nodes);
      edges.push(...result.edges);
      exitNodeIds.push(...result.exitNodeIds);
      exitStepIds.push(...result.exitStepIds);
      exitStepPaths.push(...result.exitStepPaths);
    });

    return {
      nodes,
      edges,
      entryNodeIds: nodes.filter(n => n.type === 'condition-node').map(n => n.id),
      exitNodeIds,
      exitStepIds,
      exitStepPaths,
    };
  }

  if (stepFlow.type === 'loop') {
    const { step: loopStep, serializedCondition, loopType } = stepFlow;
    const hasNestedWorkflow = loopStep.component === 'WORKFLOW' && loopStep.serializedStepFlow;
    const baseNodeId = makeNodeId(loopStep.id);
    const nodeId = allNodeIds.includes(baseNodeId) ? `${baseNodeId}-${yIndex}` : baseNodeId;
    const conditionNodeId = makeNodeId(serializedCondition.id);
    const stepPath = makeStepPath(loopStep.id);
    const conditionStepPath = makeStepPath(serializedCondition.id);

    if (hasNestedWorkflow) {
      const nestedResult = processStepGraph(loopStep.serializedStepFlow!, {
        parentGroupId: nodeId,
        idPrefix: nodeId,
        stepPathPrefix: stepPath,
      });

      const groupNode: Node = {
        id: nodeId,
        position: { x: 0, y: 0 },
        type: 'group-node',
        ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
        data: {
          label: loopStep.id,
          stepId: loopStep.id,
          stepPath,
          description: loopStep.description,
          withoutTopHandle: false,
          withoutBottomHandle: false,
          stepGraph: loopStep.serializedStepFlow,
          canSuspend: loopStep.canSuspend,
          width: nestedResult.width,
          height: nestedResult.height,
        },
      };

      const conditionNode: Node = {
        id: conditionNodeId,
        position: { x: 0, y: 0 },
        type: 'condition-node',
        ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
        data: {
          label: serializedCondition.id,
          stepPath: conditionStepPath,
          previousStepId: loopStep.id,
          isLarge: true,
          conditions: [{ type: loopType, fnString: serializedCondition.fn }],
        },
      };

      const incomingEdges = prevNodeIds.flatMap((prevNodeId, i) =>
        nestedResult.firstNodeIds.map(firstNodeId => ({
          id: `e${prevNodeId}-${firstNodeId}`,
          source: prevNodeId,
          target: firstNodeId,
          data: {
            previousStepId: prevStepIds[i] || prevStepIds[0],
            nextStepId: loopStep.id,
            previousStepPath: prevStepPaths[i] || prevStepPaths[0],
            nextStepPath: nestedResult.firstStepPaths?.[0] || stepPath,
          },
          zIndex: 1,
          ...defaultEdgeOptions,
        })),
      );

      const toConditionEdges = nestedResult.lastNodeIds.map((lastNodeId, i) => ({
        id: `e${lastNodeId}-${conditionNodeId}`,
        source: lastNodeId,
        target: conditionNodeId,
        data: {
          previousStepId: loopStep.id,
          nextStepId: serializedCondition.id,
          previousStepPath: nestedResult.lastStepPaths?.[i] || stepPath,
          nextStepPath: conditionStepPath,
        },
        zIndex: 1,
        ...defaultEdgeOptions,
      }));

      return {
        nodes: [groupNode, ...nestedResult.nodes, conditionNode],
        edges: [...incomingEdges, ...nestedResult.edges, ...toConditionEdges],
        entryNodeIds: nestedResult.firstNodeIds,
        exitNodeIds: [conditionNodeId],
        exitStepIds: [loopStep.id],
        exitStepPaths: [conditionStepPath],
      };
    }

    // Regular loop
    const stepNode: Node = {
      id: nodeId,
      position: { x: 0, y: 0 },
      type: 'default-node',
      ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
      data: {
        label: loopStep.id,
        stepId: loopStep.id,
        stepPath,
        description: loopStep.description,
        canSuspend: loopStep.canSuspend,
      },
    };

    const conditionNode: Node = {
      id: conditionNodeId,
      position: { x: 0, y: 0 },
      type: 'condition-node',
      ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
      data: {
        label: serializedCondition.id,
        stepPath: conditionStepPath,
        previousStepId: loopStep.id,
        isLarge: true,
        conditions: [{ type: loopType, fnString: serializedCondition.fn }],
      },
    };

    const edges = [
      ...prevNodeIds.map((prevNodeId, i) => ({
        id: `e${prevNodeId}-${nodeId}`,
        source: prevNodeId,
        target: nodeId,
        data: {
          previousStepId: prevStepIds[i],
          nextStepId: loopStep.id,
          previousStepPath: prevStepPaths[i],
          nextStepPath: stepPath,
        },
        ...(context.parentGroupId && { zIndex: 1 }),
        ...defaultEdgeOptions,
      })),
      {
        id: `e${nodeId}-${conditionNodeId}`,
        source: nodeId,
        target: conditionNodeId,
        data: {
          previousStepId: loopStep.id,
          nextStepId: serializedCondition.id,
          previousStepPath: stepPath,
          nextStepPath: conditionStepPath,
        },
        ...(context.parentGroupId && { zIndex: 1 }),
        ...defaultEdgeOptions,
      },
    ];

    return {
      nodes: [stepNode, conditionNode],
      edges,
      entryNodeIds: [nodeId],
      exitNodeIds: [conditionNodeId],
      exitStepIds: [loopStep.id],
      exitStepPaths: [conditionStepPath],
    };
  }

  return { nodes: [], edges: [], entryNodeIds: [], exitNodeIds: [], exitStepIds: [], exitStepPaths: [] };
}

export type ConditionConditionType = 'if' | 'else' | 'when' | 'until' | 'while' | 'dountil' | 'dowhile';

export type Condition =
  | {
      type: ConditionConditionType;
      ref: {
        step:
          | {
              id: string;
            }
          | 'trigger';
        path: string;
      };
      query: Record<string, any>;
      conj?: 'and' | 'or' | 'not';
      fnString?: never;
    }
  | {
      type: ConditionConditionType;
      fnString: string;
      ref?: never;
      query?: never;
      conj?: never;
    };

export const pathAlphabet = 'abcdefghijklmnopqrstuvwxyz'.toUpperCase().split('');

export type WStep = {
  [key: string]: {
    id: string;
    description: string;
    workflowId?: string;
    stepGraph?: any;
    stepSubscriberGraph?: any;
  };
};

export const constructNodesAndEdges = ({
  stepGraph,
}: {
  stepGraph: Workflow['serializedStepGraph'];
}): { nodes: Node[]; edges: Edge[] } => {
  if (!stepGraph || stepGraph.length === 0) {
    return { nodes: [], edges: [] };
  }

  const result = processStepGraph(stepGraph, { idPrefix: '', stepPathPrefix: '' });

  // Compute stepsFlow from edges and attach to each node's data
  const stepsFlow = result.edges.reduce(
    (acc, edge) => {
      if (edge.data) {
        const stepId = edge.data.nextStepId as string;
        const prevStepId = edge.data.previousStepId as string;
        return {
          ...acc,
          [stepId]: [...new Set([...(acc[stepId] || []), prevStepId])],
        };
      }
      return acc;
    },
    {} as Record<string, string[]>,
  );

  // Attach stepsFlow to each node's data
  const nodesWithStepsFlow = result.nodes.map(node => ({
    ...node,
    data: { ...node.data, stepsFlow },
  }));

  return { nodes: nodesWithStepsFlow, edges: result.edges };
};
