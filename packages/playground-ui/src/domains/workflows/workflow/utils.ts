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
  width: number;
  height: number;
} {
  if (!stepGraph || stepGraph.length === 0) {
    return { nodes: [], edges: [], firstNodeIds: [], lastNodeIds: [], width: NODE_WIDTH, height: NODE_HEIGHT };
  }

  let nodes: Node[] = [];
  let edges: Edge[] = [];
  let prevNodeIds: string[] = [];
  let prevStepIds: string[] = [];
  let allNodeIds: string[] = [];
  let firstNodeIds: string[] = [];

  for (let i = 0; i < stepGraph.length; i++) {
    const stepFlow = stepGraph[i];
    const nextStepFlow = i < stepGraph.length - 1 ? stepGraph[i + 1] : undefined;

    const result = processStep({
      stepFlow,
      nextStepFlow,
      prevNodeIds,
      prevStepIds,
      allNodeIds,
      yIndex: i,
      context,
    });

    if (i === 0) {
      firstNodeIds = result.entryNodeIds;
    }

    nodes.push(...result.nodes);
    edges.push(...result.edges);
    prevNodeIds = result.exitNodeIds;
    prevStepIds = result.exitStepIds;
    allNodeIds.push(...result.nodes.map(n => n.id));
  }

  // Layout the nodes
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB' });

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

  // Only use edges between direct nodes for layout
  const directNodeIds = new Set(directNodes.map(n => n.id));
  edges
    .filter(e => directNodeIds.has(e.source) && directNodeIds.has(e.target))
    .forEach(e => g.setEdge(e.source, e.target));

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
  allNodeIds,
  yIndex,
  context,
}: {
  stepFlow: SerializedStepFlowEntry;
  nextStepFlow?: SerializedStepFlowEntry;
  prevNodeIds: string[];
  prevStepIds: string[];
  allNodeIds: string[];
  yIndex: number;
  context: ProcessContext;
}): {
  nodes: Node[];
  edges: Edge[];
  entryNodeIds: string[];
  exitNodeIds: string[];
  exitStepIds: string[];
} {
  const makeNodeId = (id: string) => (context.idPrefix ? `${context.idPrefix}_${id}` : id);

  if (stepFlow.type === 'step' || stepFlow.type === 'foreach') {
    const hasNestedWorkflow = stepFlow.step.component === 'WORKFLOW' && stepFlow.step.serializedStepFlow;
    const baseNodeId = makeNodeId(stepFlow.step.id);
    const nodeId = allNodeIds.includes(baseNodeId) ? `${baseNodeId}-${yIndex}` : baseNodeId;

    if (hasNestedWorkflow) {
      // Process nested workflow recursively
      const nestedResult = processStepGraph(stepFlow.step.serializedStepFlow!, {
        parentGroupId: nodeId,
        idPrefix: nodeId,
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
          description: stepFlow.step.description,
          stepGraph: stepFlow.step.serializedStepFlow,
          canSuspend: stepFlow.step.canSuspend,
          isForEach: stepFlow.type === 'foreach',
          width: nestedResult.width,
          height: nestedResult.height,
        },
      };

      // Edges: prev → first inside, last inside → (handled by caller)
      const incomingEdges = prevNodeIds.flatMap(prevNodeId =>
        nestedResult.firstNodeIds.map(firstNodeId => ({
          id: `e${prevNodeId}-${firstNodeId}`,
          source: prevNodeId,
          target: firstNodeId,
          data: { previousStepId: prevStepIds[0], nextStepId: stepFlow.step.id },
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
      data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.step.id },
      ...(context.parentGroupId && { zIndex: 1 }),
      ...defaultEdgeOptions,
    }));

    return {
      nodes: [node],
      edges,
      entryNodeIds: [nodeId],
      exitNodeIds: [nodeId],
      exitStepIds: [stepFlow.step.id],
    };
  }

  if (stepFlow.type === 'sleep' || stepFlow.type === 'sleepUntil') {
    const baseNodeId = makeNodeId(stepFlow.id);
    const nodeId = allNodeIds.includes(baseNodeId) ? `${baseNodeId}-${yIndex}` : baseNodeId;

    const node: Node = {
      id: nodeId,
      position: { x: 0, y: 0 },
      type: 'default-node',
      ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
      data: {
        label: stepFlow.id,
        ...(stepFlow.type === 'sleepUntil' ? { date: stepFlow.date } : { duration: stepFlow.duration }),
      },
    };

    const edges = prevNodeIds.map((prevNodeId, i) => ({
      id: `e${prevNodeId}-${nodeId}`,
      source: prevNodeId,
      target: nodeId,
      data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.id },
      ...(context.parentGroupId && { zIndex: 1 }),
      ...defaultEdgeOptions,
    }));

    return {
      nodes: [node],
      edges,
      entryNodeIds: [nodeId],
      exitNodeIds: [nodeId],
      exitStepIds: [stepFlow.id],
    };
  }

  if (stepFlow.type === 'parallel') {
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let entryNodeIds: string[] = [];
    let exitNodeIds: string[] = [];
    let exitStepIds: string[] = [];

    stepFlow.steps.forEach((parallelStep, idx) => {
      const result = processStep({
        stepFlow: parallelStep,
        nextStepFlow,
        prevNodeIds,
        prevStepIds,
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
    });

    return { nodes, edges, entryNodeIds, exitNodeIds, exitStepIds };
  }

  if (stepFlow.type === 'conditional') {
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let exitNodeIds: string[] = [];
    let exitStepIds: string[] = [];

    stepFlow.steps.forEach((condStep, idx) => {
      const condition = stepFlow.serializedConditions[idx];
      const conditionNodeId = makeNodeId(condition.id);

      // Condition node
      const conditionNode: Node = {
        id: conditionNodeId,
        position: { x: 0, y: 0 },
        type: 'condition-node',
        ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
        data: {
          label: condition.id,
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
          data: { previousStepId: prevStepIds[i], nextStepId: condStep.step.id },
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
        allNodeIds: [...allNodeIds, ...nodes.map(n => n.id)],
        yIndex: yIndex + 1,
        context,
      });

      nodes.push(...result.nodes);
      edges.push(...result.edges);
      exitNodeIds.push(...result.exitNodeIds);
      exitStepIds.push(...result.exitStepIds);
    });

    return {
      nodes,
      edges,
      entryNodeIds: nodes.filter(n => n.type === 'condition-node').map(n => n.id),
      exitNodeIds,
      exitStepIds,
    };
  }

  if (stepFlow.type === 'loop') {
    const { step: loopStep, serializedCondition, loopType } = stepFlow;
    const hasNestedWorkflow = loopStep.component === 'WORKFLOW' && loopStep.serializedStepFlow;
    const baseNodeId = makeNodeId(loopStep.id);
    const nodeId = allNodeIds.includes(baseNodeId) ? `${baseNodeId}-${yIndex}` : baseNodeId;
    const conditionNodeId = makeNodeId(serializedCondition.id);

    if (hasNestedWorkflow) {
      const nestedResult = processStepGraph(loopStep.serializedStepFlow!, {
        parentGroupId: nodeId,
        idPrefix: nodeId,
      });

      const groupNode: Node = {
        id: nodeId,
        position: { x: 0, y: 0 },
        type: 'group-node',
        ...(context.parentGroupId && { parentId: context.parentGroupId, extent: 'parent' as const }),
        data: {
          label: loopStep.id,
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
          previousStepId: loopStep.id,
          isLarge: true,
          conditions: [{ type: loopType, fnString: serializedCondition.fn }],
        },
      };

      const incomingEdges = prevNodeIds.flatMap(prevNodeId =>
        nestedResult.firstNodeIds.map(firstNodeId => ({
          id: `e${prevNodeId}-${firstNodeId}`,
          source: prevNodeId,
          target: firstNodeId,
          data: { previousStepId: prevStepIds[0], nextStepId: loopStep.id },
          zIndex: 1,
          ...defaultEdgeOptions,
        })),
      );

      const toConditionEdges = nestedResult.lastNodeIds.map(lastNodeId => ({
        id: `e${lastNodeId}-${conditionNodeId}`,
        source: lastNodeId,
        target: conditionNodeId,
        data: { previousStepId: loopStep.id, nextStepId: serializedCondition.id },
        zIndex: 1,
        ...defaultEdgeOptions,
      }));

      return {
        nodes: [groupNode, ...nestedResult.nodes, conditionNode],
        edges: [...incomingEdges, ...nestedResult.edges, ...toConditionEdges],
        entryNodeIds: nestedResult.firstNodeIds,
        exitNodeIds: [conditionNodeId],
        exitStepIds: [loopStep.id],
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
        data: { previousStepId: prevStepIds[i], nextStepId: loopStep.id },
        ...(context.parentGroupId && { zIndex: 1 }),
        ...defaultEdgeOptions,
      })),
      {
        id: `e${nodeId}-${conditionNodeId}`,
        source: nodeId,
        target: conditionNodeId,
        data: { previousStepId: loopStep.id, nextStepId: serializedCondition.id },
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
    };
  }

  return { nodes: [], edges: [], entryNodeIds: [], exitNodeIds: [], exitStepIds: [] };
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

  const result = processStepGraph(stepGraph, { idPrefix: '' });
  console.log(stepGraph)
  console.log({nodes: result.nodes, edges: result.edges})
  return { nodes: result.nodes, edges: result.edges };
};
