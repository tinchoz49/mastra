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

const formatMappingLabel = (stepId: string, prevStepIds: string[], nextStepIds: string[]): string => {
  // If not a mapping node, return original ID
  if (!stepId.startsWith('mapping_')) {
    return stepId;
  }

  const capitalizeWords = (str: string) => {
    return str
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

  const formatStepName = (id: string) => {
    // Remove common prefixes and clean up
    const cleaned = id.replace(/Step$/, '').replace(/[-_]/g, ' ').trim();
    return capitalizeWords(cleaned);
  };

  const formatMultipleSteps = (ids: string[], isTarget: boolean) => {
    if (ids.length === 0) return isTarget ? 'End' : 'Start';
    if (ids.length === 1) return formatStepName(ids[0]);
    return `${ids.length} Steps`;
  };

  const fromLabel = formatMultipleSteps(prevStepIds, false);
  const toLabel = formatMultipleSteps(nextStepIds, true);

  return `${fromLabel} → ${toLabel} Map`;
};

const getLayoutedElements = (nodes: Node[], edges: Edge[]) => {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB' });

  // Separate group nodes from regular nodes
  const groupNodes = nodes.filter(n => n.type === 'group-node');
  const childNodes = nodes.filter(n => n.parentId);
  const regularNodes = nodes.filter(n => n.type !== 'group-node' && !n.parentId);

  // Layout regular nodes and group nodes (groups act as single units)
  const topLevelNodes = [...regularNodes, ...groupNodes];

  // Filter edges to only include top-level connections
  const topLevelEdges = edges.filter(edge => {
    const sourceNode = nodes.find(n => n.id === edge.source);
    const targetNode = nodes.find(n => n.id === edge.target);
    // Include edge if both nodes are top-level OR if edge connects to/from a group
    const sourceIsTopLevel = !sourceNode?.parentId;
    const targetIsTopLevel = !targetNode?.parentId;
    return sourceIsTopLevel && targetIsTopLevel;
  });

  topLevelEdges.forEach(edge => g.setEdge(edge.source, edge.target));
  topLevelNodes.forEach(node => {
    const nodeData = node.data as Record<string, unknown>;
    const width = (typeof nodeData?.width === 'number' ? nodeData.width : null) ?? node.measured?.width ?? NODE_WIDTH;
    const height =
      (typeof nodeData?.height === 'number' ? nodeData.height : null) ??
      node.measured?.height ??
      (nodeData?.isLarge ? NODE_HEIGHT_LARGE : NODE_HEIGHT);
    g.setNode(node.id, { ...node, width, height });
  });

  Dagre.layout(g);

  const fullWidth = g.graph()?.width ? g.graph().width! / 2 : 0;
  const fullHeight = g.graph()?.height ? g.graph().height! / 2 : 0;

  // Position top-level nodes
  const positionedTopLevel = topLevelNodes.map(node => {
    const position = g.node(node.id);
    const nodeData = node.data as Record<string, unknown>;
    const width = (typeof nodeData?.width === 'number' ? nodeData.width : null) ?? node.measured?.width ?? NODE_WIDTH;
    const height =
      (typeof nodeData?.height === 'number' ? nodeData.height : null) ??
      node.measured?.height ??
      (nodeData?.isLarge ? NODE_HEIGHT_LARGE : NODE_HEIGHT);
    const positionX = position.x - width / 2;
    const positionY = position.y - height / 2;
    return { ...node, position: { x: positionX, y: positionY } };
  });

  // Child nodes already have positions relative to their parent
  const allNodes = [...positionedTopLevel, ...childNodes];

  return {
    nodes: allNodes,
    edges,
    fullWidth,
    fullHeight,
  };
};

/**
 * Process nested workflow stepGraph and return flattened nodes/edges with parentId set
 */
const processNestedWorkflow = ({
  stepGraph,
  groupId,
  groupLabel,
}: {
  stepGraph: SerializedStepFlowEntry[];
  groupId: string;
  groupLabel: string;
}): { nodes: Node[]; edges: Edge[]; firstNodeIds: string[]; lastNodeIds: string[]; width: number; height: number } => {
  if (!stepGraph || stepGraph.length === 0) {
    return { nodes: [], edges: [], firstNodeIds: [], lastNodeIds: [], width: NODE_WIDTH, height: NODE_HEIGHT };
  }

  // Create a sub-graph for the nested workflow
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB' });

  let nodes: Node[] = [];
  let edges: Edge[] = [];
  let prevNodeIds: string[] = [];
  let prevStepIds: string[] = [];
  let allPrevNodeIds: string[] = [];
  let firstNodeIds: string[] = [];

  for (let index = 0; index < stepGraph.length; index++) {
    const stepFlow = stepGraph[index];
    const nextStepFlow = index === stepGraph.length - 1 ? undefined : stepGraph[index + 1];

    const {
      nodes: _nodes,
      edges: _edges,
      nextPrevNodeIds,
      nextPrevStepIds,
    } = getNestedStepNodeAndEdge({
      stepFlow,
      xIndex: index,
      yIndex: index,
      prevNodeIds,
      prevStepIds,
      nextStepFlow,
      allPrevNodeIds,
      groupId,
      groupLabel,
    });

    if (index === 0) {
      firstNodeIds = _nodes.filter(n => n.type !== 'condition-node').map(n => n.id);
    }

    nodes.push(..._nodes);
    edges.push(..._edges);
    prevNodeIds = nextPrevNodeIds;
    prevStepIds = nextPrevStepIds;
    allPrevNodeIds.push(...prevNodeIds);
  }

  // Layout the nested nodes
  edges.forEach(edge => g.setEdge(edge.source, edge.target));
  nodes.forEach(node =>
    g.setNode(node.id, {
      ...node,
      width: node.measured?.width ?? NODE_WIDTH,
      height: node.measured?.height ?? (node?.data?.isLarge ? NODE_HEIGHT_LARGE : NODE_HEIGHT),
    }),
  );

  Dagre.layout(g);

  const graphWidth = g.graph()?.width ?? NODE_WIDTH;
  const graphHeight = g.graph()?.height ?? NODE_HEIGHT;

  // Position nodes relative to group (with padding for header)
  const positionedNodes = nodes.map(node => {
    const position = g.node(node.id);
    const nodeWidth = node.measured?.width ?? NODE_WIDTH;
    const nodeHeight = node.measured?.height ?? (node?.data?.isLarge ? NODE_HEIGHT_LARGE : NODE_HEIGHT);
    return {
      ...node,
      parentId: groupId,
      extent: 'parent' as const,
      position: {
        x: position.x - nodeWidth / 2 + GROUP_PADDING,
        y: position.y - nodeHeight / 2 + GROUP_HEADER_HEIGHT + GROUP_PADDING,
      },
    };
  });

  // Calculate group dimensions
  const width = graphWidth + GROUP_PADDING * 2;
  const height = graphHeight + GROUP_HEADER_HEIGHT + GROUP_PADDING * 2;

  return {
    nodes: positionedNodes,
    edges,
    firstNodeIds,
    lastNodeIds: prevNodeIds,
    width: Math.max(width, 300),
    height: Math.max(height, 150),
  };
};

/**
 * Process steps within a nested workflow - simplified version that creates regular nodes
 */
const getNestedStepNodeAndEdge = ({
  stepFlow,
  xIndex,
  yIndex,
  prevNodeIds,
  prevStepIds,
  nextStepFlow,
  allPrevNodeIds,
  groupId,
  groupLabel,
}: {
  stepFlow: SerializedStepFlowEntry;
  xIndex: number;
  yIndex: number;
  prevNodeIds: string[];
  prevStepIds: string[];
  nextStepFlow?: SerializedStepFlowEntry;
  allPrevNodeIds: string[];
  groupId: string;
  groupLabel: string;
}): { nodes: Node[]; edges: Edge[]; nextPrevNodeIds: string[]; nextPrevStepIds: string[] } => {
  let nextNodeIds: string[] = [];
  let nextStepIds: string[] = [];

  // Calculate next step connections (similar to main function)
  if (nextStepFlow?.type === 'step' || nextStepFlow?.type === 'foreach' || nextStepFlow?.type === 'loop') {
    const baseId = `${groupId}_${nextStepFlow.step.id}`;
    nextNodeIds = [allPrevNodeIds?.includes(baseId) ? `${baseId}-${yIndex + 1}` : baseId];
    nextStepIds = [nextStepFlow.step.id];
  }
  if (nextStepFlow?.type === 'sleep' || nextStepFlow?.type === 'sleepUntil') {
    const baseId = `${groupId}_${nextStepFlow.id}`;
    nextNodeIds = [allPrevNodeIds?.includes(baseId) ? `${baseId}-${yIndex + 1}` : baseId];
    nextStepIds = [nextStepFlow.id];
  }
  if (nextStepFlow?.type === 'parallel') {
    nextNodeIds = nextStepFlow?.steps.map(step => {
      const baseId = `${groupId}_${step.step.id}`;
      return allPrevNodeIds?.includes(baseId) ? `${baseId}-${yIndex + 1}` : baseId;
    }) || [];
    nextStepIds = nextStepFlow?.steps.map(step => step.step.id) || [];
  }
  if (nextStepFlow?.type === 'conditional') {
    nextNodeIds = nextStepFlow?.serializedConditions.map(cond => `${groupId}_${cond.id}`) || [];
    nextStepIds = nextStepFlow?.steps?.map(step => step.step.id) || [];
  }

  if (stepFlow.type === 'step' || stepFlow.type === 'foreach') {
    const hasNestedGraph = stepFlow.step.component === 'WORKFLOW';
    const baseId = `${groupId}_${stepFlow.step.id}`;
    const nodeId = allPrevNodeIds?.includes(baseId) ? `${baseId}-${yIndex}` : baseId;

    // For deeply nested workflows, we still use nested-node (could be recursive groups in future)
    const nodes: Node[] = [
      {
        id: nodeId,
        position: { x: xIndex * 300, y: yIndex * 100 },
        type: hasNestedGraph ? 'nested-node' : 'default-node',
        data: {
          label: stepFlow.step.id,
          stepId: stepFlow.step.id,
          description: stepFlow.step.description,
          withoutTopHandle: !prevNodeIds.length,
          withoutBottomHandle: !nextNodeIds.length,
          stepGraph: hasNestedGraph ? stepFlow.step.serializedStepFlow : undefined,
          mapConfig: stepFlow.step.mapConfig,
          canSuspend: stepFlow.step.canSuspend,
          isForEach: stepFlow.type === 'foreach',
        },
      },
    ];

    const edges: Edge[] = [
      ...(prevNodeIds || []).map((prevNodeId, i) => ({
        id: `e${prevNodeId}-${nodeId}`,
        source: prevNodeId,
        data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.step.id },
        target: nodeId,
        ...defaultEdgeOptions,
      })),
      ...(nextNodeIds || []).map((nextNodeId, i) => ({
        id: `e${nodeId}-${nextNodeId}`,
        source: nodeId,
        data: { previousStepId: stepFlow.step.id, nextStepId: nextStepIds[i] },
        target: nextNodeId,
        ...defaultEdgeOptions,
      })),
    ];

    return { nodes, edges, nextPrevNodeIds: [nodeId], nextPrevStepIds: [stepFlow.step.id] };
  }

  if (stepFlow.type === 'sleep' || stepFlow.type === 'sleepUntil') {
    const baseId = `${groupId}_${stepFlow.id}`;
    const nodeId = allPrevNodeIds?.includes(baseId) ? `${baseId}-${yIndex}` : baseId;

    const nodes: Node[] = [
      {
        id: nodeId,
        position: { x: xIndex * 300, y: yIndex * 100 },
        type: 'default-node',
        data: {
          label: stepFlow.id,
          withoutTopHandle: !prevNodeIds.length,
          withoutBottomHandle: !nextNodeIds.length,
          ...(stepFlow.type === 'sleepUntil' ? { date: stepFlow.date } : { duration: stepFlow.duration }),
        },
      },
    ];

    const edges: Edge[] = [
      ...(prevNodeIds || []).map((prevNodeId, i) => ({
        id: `e${prevNodeId}-${nodeId}`,
        source: prevNodeId,
        data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.id },
        target: nodeId,
        ...defaultEdgeOptions,
      })),
      ...(nextNodeIds || []).map((nextNodeId, i) => ({
        id: `e${nodeId}-${nextNodeId}`,
        source: nodeId,
        data: { previousStepId: stepFlow.id, nextStepId: nextStepIds[i] },
        target: nextNodeId,
        ...defaultEdgeOptions,
      })),
    ];

    return { nodes, edges, nextPrevNodeIds: [nodeId], nextPrevStepIds: [stepFlow.id] };
  }

  if (stepFlow.type === 'parallel') {
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let nextPrevStepIds: string[] = [];

    stepFlow.steps.forEach((_stepFlow, index) => {
      const result = getNestedStepNodeAndEdge({
        stepFlow: _stepFlow,
        xIndex: index,
        yIndex,
        prevNodeIds,
        prevStepIds,
        nextStepFlow,
        allPrevNodeIds,
        groupId,
        groupLabel,
      });
      const markedNodes = result.nodes.map(node => ({
        ...node,
        data: { ...node.data, isParallel: true },
      }));
      nodes.push(...markedNodes);
      edges.push(...result.edges);
      nextPrevStepIds.push(...result.nextPrevStepIds);
    });

    return { nodes, edges, nextPrevNodeIds: nodes.map(n => n.id), nextPrevStepIds };
  }

  return { nodes: [], edges: [], nextPrevNodeIds: [], nextPrevStepIds: [] };
};

const defaultEdgeOptions = {
  animated: true,
  markerEnd: {
    type: MarkerType.ArrowClosed,
    width: 20,
    height: 20,
    color: '#8e8e8e',
  },
};

export type WStep = {
  [key: string]: {
    id: string;
    description: string;
    workflowId?: string;
    stepGraph?: any;
    stepSubscriberGraph?: any;
  };
};

const getStepNodeAndEdge = ({
  stepFlow,
  xIndex,
  yIndex,
  prevNodeIds,
  prevStepIds,
  nextStepFlow,
  condition,
  allPrevNodeIds,
}: {
  stepFlow: SerializedStepFlowEntry;
  xIndex: number;
  yIndex: number;
  prevNodeIds: string[];
  prevStepIds: string[];
  nextStepFlow?: SerializedStepFlowEntry;
  condition?: { id: string; fn: string };
  allPrevNodeIds: string[];
}): { nodes: Node[]; edges: Edge[]; nextPrevNodeIds: string[]; nextPrevStepIds: string[] } => {
  let nextNodeIds: string[] = [];
  let nextStepIds: string[] = [];
  if (nextStepFlow?.type === 'step' || nextStepFlow?.type === 'foreach' || nextStepFlow?.type === 'loop') {
    const nextStepId = allPrevNodeIds?.includes(nextStepFlow.step.id)
      ? `${nextStepFlow.step.id}-${yIndex + 1}`
      : nextStepFlow.step.id;
    nextNodeIds = [nextStepId];
    nextStepIds = [nextStepFlow.step.id];
  }
  if (nextStepFlow?.type === 'sleep' || nextStepFlow?.type === 'sleepUntil') {
    const nextStepId = allPrevNodeIds?.includes(nextStepFlow.id) ? `${nextStepFlow.id}-${yIndex + 1}` : nextStepFlow.id;
    nextNodeIds = [nextStepId];
    nextStepIds = [nextStepFlow.id];
  }
  if (nextStepFlow?.type === 'parallel') {
    nextNodeIds =
      nextStepFlow?.steps.map(step => {
        const stepId = step.step.id;
        const nextStepId = allPrevNodeIds?.includes(stepId) ? `${stepId}-${yIndex + 1}` : stepId;
        return nextStepId;
      }) || [];
    nextStepIds = nextStepFlow?.steps.map(step => step.step.id) || [];
  }
  if (nextStepFlow?.type === 'conditional') {
    nextNodeIds = nextStepFlow?.serializedConditions.map(cond => cond.id) || [];
    nextStepIds = nextStepFlow?.steps?.map(step => step.step.id) || [];
  }

  if (stepFlow.type === 'step' || stepFlow.type === 'foreach') {
    const hasGraph = stepFlow.step.component === 'WORKFLOW';
    const nodeId = allPrevNodeIds?.includes(stepFlow.step.id) ? `${stepFlow.step.id}-${yIndex}` : stepFlow.step.id;

    // Handle nested workflows as group nodes
    if (hasGraph && stepFlow.step.serializedStepFlow) {
      const { nodes: nestedNodes, edges: nestedEdges, firstNodeIds, lastNodeIds, width, height } = processNestedWorkflow({
        stepGraph: stepFlow.step.serializedStepFlow,
        groupId: nodeId,
        groupLabel: stepFlow.step.id,
      });

      const conditionNodes = condition
        ? [
            {
              id: condition.id,
              position: { x: xIndex * 300, y: yIndex * 100 },
              type: 'condition-node',
              data: {
                label: condition.id,
                previousStepId: prevStepIds[prevStepIds.length - 1],
                nextStepId: stepFlow.step.id,
                withoutTopHandle: !prevNodeIds.length,
                withoutBottomHandle: false,
                isLarge: true,
                conditions: [{ type: 'when', fnString: condition.fn }],
              },
            },
          ]
        : [];

      // Create the group node
      const groupNode: Node = {
        id: nodeId,
        position: { x: xIndex * 300, y: (yIndex + (condition ? 1 : 0)) * 100 },
        type: 'group-node',
        data: {
          label: formatMappingLabel(stepFlow.step.id, prevStepIds, nextStepIds),
          stepId: stepFlow.step.id,
          description: stepFlow.step.description,
          withoutTopHandle: condition ? false : !prevNodeIds.length,
          withoutBottomHandle: !nextNodeIds.length,
          stepGraph: stepFlow.step.serializedStepFlow,
          canSuspend: stepFlow.step.canSuspend,
          isForEach: stepFlow.type === 'foreach',
          width,
          height,
        },
      };

      const nodes = [...conditionNodes, groupNode, ...nestedNodes];

      // Build edges - connect to first nodes inside group and from last nodes
      const incomingEdges = condition
        ? [
            ...(prevNodeIds || []).map((prevNodeId, i) => ({
              id: `e${prevNodeId}-${condition.id}`,
              source: prevNodeId,
              data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.step.id },
              target: condition.id,
              ...defaultEdgeOptions,
            })),
            ...firstNodeIds.map(firstNodeId => ({
              id: `e${condition.id}-${firstNodeId}`,
              source: condition.id,
              data: {
                previousStepId: prevStepIds[prevStepIds.length - 1],
                nextStepId: stepFlow.step.id,
                conditionNode: true,
              },
              target: firstNodeId,
              zIndex: 1,
              ...defaultEdgeOptions,
            })),
          ]
        : (prevNodeIds || []).flatMap((prevNodeId, i) =>
            firstNodeIds.map(firstNodeId => ({
              id: `e${prevNodeId}-${firstNodeId}`,
              source: prevNodeId,
              data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.step.id },
              target: firstNodeId,
              zIndex: 1,
              ...defaultEdgeOptions,
            })),
          );

      const outgoingEdges = (nextNodeIds || []).flatMap((nextNodeId, i) =>
        lastNodeIds.map(lastNodeId => ({
          id: `e${lastNodeId}-${nextNodeId}`,
          source: lastNodeId,
          data: { previousStepId: stepFlow.step.id, nextStepId: nextStepIds[i] },
          target: nextNodeId,
          zIndex: 1,
          ...defaultEdgeOptions,
        })),
      );

      const edges = [...incomingEdges, ...nestedEdges, ...outgoingEdges];

      return { nodes, edges, nextPrevNodeIds: lastNodeIds.length ? lastNodeIds : [nodeId], nextPrevStepIds: [stepFlow.step.id] };
    }

    // Regular step node (non-nested)
    const nodes = [
      ...(condition
        ? [
            {
              id: condition.id,
              position: { x: xIndex * 300, y: yIndex * 100 },
              type: 'condition-node',
              data: {
                label: condition.id,
                previousStepId: prevStepIds[prevStepIds.length - 1],
                nextStepId: stepFlow.step.id,
                withoutTopHandle: !prevNodeIds.length,
                withoutBottomHandle: !nextNodeIds.length,
                isLarge: true,
                conditions: [{ type: 'when', fnString: condition.fn }],
              },
            },
          ]
        : []),
      {
        id: nodeId,
        position: { x: xIndex * 300, y: (yIndex + (condition ? 1 : 0)) * 100 },
        type: 'default-node',
        data: {
          label: formatMappingLabel(stepFlow.step.id, prevStepIds, nextStepIds),
          stepId: stepFlow.step.id,
          description: stepFlow.step.description,
          withoutTopHandle: condition ? false : !prevNodeIds.length,
          withoutBottomHandle: !nextNodeIds.length,
          mapConfig: stepFlow.step.mapConfig,
          canSuspend: stepFlow.step.canSuspend,
          isForEach: stepFlow.type === 'foreach',
        },
      },
    ];
    const edges = [
      ...(condition
        ? [
            ...(prevNodeIds || []).map((prevNodeId, i) => ({
              id: `e${prevNodeId}-${condition.id}`,
              source: prevNodeId,
              data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.step.id },
              target: condition.id,
              ...defaultEdgeOptions,
            })),
            {
              id: `e${condition.id}-${nodeId}`,
              source: condition.id,
              data: {
                previousStepId: prevStepIds[prevStepIds.length - 1],
                nextStepId: stepFlow.step.id,
                conditionNode: true,
              },
              target: nodeId,
              ...defaultEdgeOptions,
            },
          ]
        : (prevNodeIds || []).map((prevNodeId, i) => ({
            id: `e${prevNodeId}-${nodeId}`,
            source: prevNodeId,
            data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.step.id },
            target: nodeId,
            ...defaultEdgeOptions,
          }))),
      ...(nextNodeIds || []).map((nextNodeId, i) => ({
        id: `e${nodeId}-${nextNodeId}`,
        source: nodeId,
        data: { previousStepId: stepFlow.step.id, nextStepId: nextStepIds[i] },
        target: nextNodeId,
        ...defaultEdgeOptions,
      })),
    ];
    return { nodes, edges, nextPrevNodeIds: [nodeId], nextPrevStepIds: [stepFlow.step.id] };
  }

  if (stepFlow.type === 'sleep' || stepFlow.type === 'sleepUntil') {
    const nodeId = allPrevNodeIds?.includes(stepFlow.id) ? `${stepFlow.id}-${yIndex}` : stepFlow.id;
    const nodes = [
      ...(condition
        ? [
            {
              id: condition.id,
              position: { x: xIndex * 300, y: yIndex * 100 },
              type: 'condition-node',
              data: {
                label: condition.id,
                previousStepId: prevStepIds[prevStepIds.length - 1],
                nextStepId: stepFlow.id,
                withoutTopHandle: false,
                withoutBottomHandle: !nextNodeIds.length,
                isLarge: true,
                conditions: [{ type: 'when', fnString: condition.fn }],
              },
            },
          ]
        : []),
      {
        id: nodeId,
        position: { x: xIndex * 300, y: (yIndex + (condition ? 1 : 0)) * 100 },
        type: 'default-node',
        data: {
          label: stepFlow.id,
          withoutTopHandle: condition ? false : !prevNodeIds.length,
          withoutBottomHandle: !nextNodeIds.length,
          ...(stepFlow.type === 'sleepUntil' ? { date: stepFlow.date } : { duration: stepFlow.duration }),
        },
      },
    ];
    const edges = [
      ...(!prevNodeIds.length
        ? []
        : condition
          ? [
              ...prevNodeIds.map((prevNodeId, i) => ({
                id: `e${prevNodeId}-${condition.id}`,
                source: prevNodeId,
                data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.id },
                target: condition.id,
                ...defaultEdgeOptions,
              })),
              {
                id: `e${condition.id}-${nodeId}`,
                source: condition.id,
                data: { previousStepId: prevStepIds[prevStepIds.length - 1], nextStepId: stepFlow.id },
                target: nodeId,
                ...defaultEdgeOptions,
              },
            ]
          : prevNodeIds.map((prevNodeId, i) => ({
              id: `e${prevNodeId}-${nodeId}`,
              source: prevNodeId,
              data: { previousStepId: prevStepIds[i], nextStepId: stepFlow.id },
              target: nodeId,
              ...defaultEdgeOptions,
            }))),
      ...(!nextNodeIds.length
        ? []
        : nextNodeIds.map((nextNodeId, i) => ({
            id: `e${nodeId}-${nextNodeId}`,
            source: nodeId,
            data: { previousStepId: stepFlow.id, nextStepId: nextStepIds[i] },
            target: nextNodeId,
            ...defaultEdgeOptions,
          }))),
    ];
    return { nodes, edges, nextPrevNodeIds: [nodeId], nextPrevStepIds: [stepFlow.id] };
  }

  if (stepFlow.type === 'loop') {
    const { step: _step, serializedCondition, loopType } = stepFlow;
    const hasGraph = _step.component === 'WORKFLOW';

    // Handle nested workflows in loops as group nodes
    if (hasGraph && _step.serializedStepFlow) {
      const { nodes: nestedNodes, edges: nestedEdges, firstNodeIds, lastNodeIds, width, height } = processNestedWorkflow({
        stepGraph: _step.serializedStepFlow,
        groupId: _step.id,
        groupLabel: _step.id,
      });

      const groupNode: Node = {
        id: _step.id,
        position: { x: xIndex * 300, y: yIndex * 100 },
        type: 'group-node',
        data: {
          label: _step.id,
          description: _step.description,
          withoutTopHandle: !prevNodeIds.length,
          withoutBottomHandle: false,
          stepGraph: _step.serializedStepFlow,
          canSuspend: _step.canSuspend,
          width,
          height,
        },
      };

      const conditionNode = {
        id: serializedCondition.id,
        position: { x: xIndex * 300, y: (yIndex + 1) * 100 },
        type: 'condition-node',
        data: {
          label: serializedCondition.id,
          previousStepId: _step.id,
          nextStepId: nextStepIds[0],
          withoutTopHandle: false,
          withoutBottomHandle: !nextNodeIds.length,
          isLarge: true,
          conditions: [{ type: loopType, fnString: serializedCondition.fn }],
        },
      };

      const nodes = [groupNode, ...nestedNodes, conditionNode];

      const incomingEdges = !prevNodeIds.length
        ? []
        : prevNodeIds.flatMap((prevNodeId, i) =>
            firstNodeIds.map(firstNodeId => ({
              id: `e${prevNodeId}-${firstNodeId}`,
              source: prevNodeId,
              data: { previousStepId: prevStepIds[i], nextStepId: _step.id },
              target: firstNodeId,
              zIndex: 1,
              ...defaultEdgeOptions,
            })),
          );

      const toConditionEdges = lastNodeIds.map(lastNodeId => ({
        id: `e${lastNodeId}-${serializedCondition.id}`,
        source: lastNodeId,
        data: { previousStepId: _step.id, nextStepId: nextStepIds[0] },
        target: serializedCondition.id,
        zIndex: 1,
        ...defaultEdgeOptions,
      }));

      const outgoingEdges = !nextNodeIds.length
        ? []
        : nextNodeIds.map((nextNodeId, i) => ({
            id: `e${serializedCondition.id}-${nextNodeId}`,
            source: serializedCondition.id,
            data: { previousStepId: _step.id, nextStepId: nextStepIds[i] },
            target: nextNodeId,
            ...defaultEdgeOptions,
          }));

      const edges = [...incomingEdges, ...nestedEdges, ...toConditionEdges, ...outgoingEdges];

      return { nodes, edges, nextPrevNodeIds: [serializedCondition.id], nextPrevStepIds: [_step.id] };
    }

    // Regular loop node (non-nested)
    const nodes = [
      {
        id: _step.id,
        position: { x: xIndex * 300, y: yIndex * 100 },
        type: 'default-node',
        data: {
          label: _step.id,
          description: _step.description,
          withoutTopHandle: !prevNodeIds.length,
          withoutBottomHandle: false,
          canSuspend: _step.canSuspend,
        },
      },
      {
        id: serializedCondition.id,
        position: { x: xIndex * 300, y: (yIndex + 1) * 100 },
        type: 'condition-node',
        data: {
          label: serializedCondition.id,
          previousStepId: _step.id,
          nextStepId: nextStepIds[0],
          withoutTopHandle: false,
          withoutBottomHandle: !nextNodeIds.length,
          isLarge: true,
          conditions: [{ type: loopType, fnString: serializedCondition.fn }],
        },
      },
    ];

    const edges = [
      ...(!prevNodeIds.length
        ? []
        : prevNodeIds.map((prevNodeId, i) => ({
            id: `e${prevNodeId}-${_step.id}`,
            source: prevNodeId,
            data: { previousStepId: prevStepIds[i], nextStepId: _step.id },
            target: _step.id,
            ...defaultEdgeOptions,
          }))),
      {
        id: `e${_step.id}-${serializedCondition.id}`,
        source: _step.id,
        data: { previousStepId: _step.id, nextStepId: nextStepIds[0] },
        target: serializedCondition.id,
        ...defaultEdgeOptions,
      },
      ...(!nextNodeIds.length
        ? []
        : nextNodeIds.map((nextNodeId, i) => ({
            id: `e${serializedCondition.id}-${nextNodeId}`,
            source: serializedCondition.id,
            data: { previousStepId: _step.id, nextStepId: nextStepIds[i] },
            target: nextNodeId,
            ...defaultEdgeOptions,
          }))),
    ];

    return { nodes, edges, nextPrevNodeIds: [serializedCondition.id], nextPrevStepIds: [_step.id] };
  }

  if (stepFlow.type === 'parallel') {
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let nextPrevStepIds: string[] = [];
    stepFlow.steps.forEach((_stepFlow, index) => {
      const {
        nodes: _nodes,
        edges: _edges,
        nextPrevStepIds: _nextPrevStepIds,
      } = getStepNodeAndEdge({
        stepFlow: _stepFlow,
        xIndex: index,
        yIndex,
        prevNodeIds,
        prevStepIds,
        nextStepFlow,
        allPrevNodeIds,
      });
      // Mark nodes as part of parallel execution
      const markedNodes = _nodes.map(node => ({
        ...node,
        data: {
          ...node.data,
          isParallel: true,
        },
      }));
      nodes.push(...markedNodes);
      edges.push(..._edges);
      nextPrevStepIds.push(..._nextPrevStepIds);
    });

    return { nodes, edges, nextPrevNodeIds: nodes.map(node => node.id), nextPrevStepIds };
  }

  if (stepFlow.type === 'conditional') {
    let nodes: Node[] = [];
    let edges: Edge[] = [];
    let nextPrevStepIds: string[] = [];
    stepFlow.steps.forEach((_stepFlow, index) => {
      const {
        nodes: _nodes,
        edges: _edges,
        nextPrevStepIds: _nextPrevStepIds,
      } = getStepNodeAndEdge({
        stepFlow: _stepFlow,
        xIndex: index,
        yIndex,
        prevNodeIds,
        prevStepIds,
        nextStepFlow,
        condition: stepFlow.serializedConditions[index],
        allPrevNodeIds,
      });
      nodes.push(..._nodes);
      edges.push(..._edges);
      nextPrevStepIds.push(..._nextPrevStepIds);
    });

    return {
      nodes,
      edges,
      nextPrevNodeIds: nodes.filter(({ type }) => type !== 'condition-node').map(node => node.id),
      nextPrevStepIds,
    };
  }

  return { nodes: [], edges: [], nextPrevNodeIds: [], nextPrevStepIds: [] };
};

export const constructNodesAndEdges = ({
  stepGraph,
}: {
  stepGraph: Workflow['serializedStepGraph'];
}): { nodes: Node[]; edges: Edge[] } => {
  if (!stepGraph) {
    return { nodes: [], edges: [] };
  }

  if (stepGraph.length === 0) {
    return { nodes: [], edges: [] };
  }

  let nodes: Node[] = [];
  let edges: Edge[] = [];

  let prevNodeIds: string[] = [];
  let prevStepIds: string[] = [];
  let allPrevNodeIds: string[] = [];

  for (let index = 0; index < stepGraph.length; index++) {
    const {
      nodes: _nodes,
      edges: _edges,
      nextPrevNodeIds,
      nextPrevStepIds,
    } = getStepNodeAndEdge({
      stepFlow: stepGraph[index],
      xIndex: index,
      yIndex: index,
      prevNodeIds,
      prevStepIds,
      nextStepFlow: index === stepGraph.length - 1 ? undefined : stepGraph[index + 1],
      allPrevNodeIds,
    });
    nodes.push(..._nodes);
    edges.push(..._edges);
    prevNodeIds = nextPrevNodeIds;
    prevStepIds = nextPrevStepIds;
    allPrevNodeIds.push(...prevNodeIds);
  }

  const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges);

  return { nodes: layoutedNodes, edges: layoutedEdges };
};
