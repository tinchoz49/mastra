import { ReactFlow, Background, useNodesState, useEdgesState, BackgroundVariant, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GetWorkflowResponse } from '@mastra/client-js';

import { constructNodesAndEdges } from './utils';
import { WorkflowConditionNode } from './workflow-condition-node';
import { DefaultNode, WorkflowDefaultNode } from './workflow-default-node';
import { WorkflowAfterNode } from './workflow-after-node';
import { WorkflowLoopResultNode } from './workflow-loop-result-node';
import { NestedNode, WorkflowNestedNode } from './workflow-nested-node';
import { GroupNode, WorkflowGroupNode } from './workflow-group-node';
import { ZoomSlider } from './zoom-slider';

import { useCurrentRun } from '../context/use-current-run';
import { useMemo } from 'react';

export interface WorkflowGraphInnerProps {
  workflow: {
    stepGraph: GetWorkflowResponse['stepGraph'];
  };
}

export function WorkflowGraphInner({ workflow }: WorkflowGraphInnerProps) {
  const { nodes: initialNodes, edges: initialEdges } = constructNodesAndEdges(workflow);
  const [nodes, _, onNodesChange] = useNodesState(initialNodes);
  const [edges] = useEdgesState(initialEdges);
  const { steps } = useCurrentRun();

  const stepsFlow = useMemo(() => {
    return initialEdges.reduce(
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
  }, [initialEdges]);

  const nodeTypes = {
    'default-node': (props: NodeProps<DefaultNode>) => <WorkflowDefaultNode {...props} stepsFlow={stepsFlow} />,
    'condition-node': WorkflowConditionNode,
    'after-node': WorkflowAfterNode,
    'loop-result-node': WorkflowLoopResultNode,
    'nested-node': (props: NodeProps<NestedNode>) => <WorkflowNestedNode {...props} stepsFlow={stepsFlow} />,
    'group-node': (props: NodeProps<GroupNode>) => <WorkflowGroupNode {...props} />,
  };

  return (
    <div className="w-full h-full bg-surface1">
      <ReactFlow
        nodes={nodes}
        edges={edges.map(e => ({
          ...e,
          zIndex: e.zIndex ?? 1, // Ensure all edges have zIndex for group rendering
          style: {
            ...e.style,
            stroke:
              // Use stepPath for nested workflow steps, fallback to stepId for backwards compatibility
              steps[e.data?.previousStepPath as string]?.status === 'success' && steps[e.data?.nextStepPath as string]
                ? '#22c55e'
                : steps[e.data?.previousStepId as string]?.status === 'success' && steps[e.data?.nextStepId as string]
                  ? '#22c55e'
                  : e.data?.conditionNode &&
                      !steps[e.data?.previousStepPath as string] &&
                      !steps[e.data?.previousStepId as string] &&
                      (Boolean(steps[e.data?.nextStepPath as string]?.status) || Boolean(steps[e.data?.nextStepId as string]?.status))
                    ? '#22c55e'
                    : undefined,
          },
        }))}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        fitView
        fitViewOptions={{
          maxZoom: 1,
        }}
        minZoom={0.01}
        maxZoom={1}
      >
        <ZoomSlider position="bottom-left" />

        <Background variant={BackgroundVariant.Dots} gap={12} size={0.5} />
      </ReactFlow>
    </div>
  );
}
