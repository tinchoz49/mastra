import { ReactFlow, Background, useNodesState, useEdgesState, BackgroundVariant } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { GetWorkflowResponse } from '@mastra/client-js';

import { constructNodesAndEdges } from './utils';
import { WorkflowConditionNode } from './workflow-condition-node';
import { WorkflowDefaultNode } from './workflow-default-node';
import { WorkflowAfterNode } from './workflow-after-node';
import { WorkflowLoopResultNode } from './workflow-loop-result-node';
import { WorkflowNestedNode } from './workflow-nested-node';
import { WorkflowGroupNode } from './workflow-group-node';
import { ZoomSlider } from './zoom-slider';

import { useCurrentRun } from '../context/use-current-run';

// Define nodeTypes outside component for stable reference (prevents remounting on re-render)
const nodeTypes = {
  'default-node': WorkflowDefaultNode,
  'condition-node': WorkflowConditionNode,
  'after-node': WorkflowAfterNode,
  'loop-result-node': WorkflowLoopResultNode,
  'nested-node': WorkflowNestedNode,
  'group-node': WorkflowGroupNode,
};

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
