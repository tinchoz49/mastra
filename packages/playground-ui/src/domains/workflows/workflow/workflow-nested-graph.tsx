import { ReactFlow, Background, useNodesState, useEdgesState, BackgroundVariant, NodeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { SerializedStepFlowEntry } from '@mastra/core/workflows';

import { constructNodesAndEdges } from './utils';
import { WorkflowConditionNode } from './workflow-condition-node';
import { DefaultNode, WorkflowDefaultNode } from './workflow-default-node';
import { WorkflowAfterNode } from './workflow-after-node';
import { WorkflowLoopResultNode } from './workflow-loop-result-node';
import { useEffect, useMemo, useState } from 'react';
import Spinner from '@/components/ui/spinner';
import { NestedNode, WorkflowNestedNode } from './workflow-nested-node';
import { GroupNode, WorkflowGroupNode } from './workflow-group-node';
import { ZoomSlider } from './zoom-slider';
import { useCurrentRun } from '../context/use-current-run';

export interface WorkflowNestedGraphProps {
  stepGraph: SerializedStepFlowEntry[];
  open: boolean;
  workflowName: string;
}

export function WorkflowNestedGraph({ stepGraph, open, workflowName }: WorkflowNestedGraphProps) {
  const { nodes: initialNodes, edges: initialEdges } = constructNodesAndEdges({
    stepGraph,
  });
  const [isMounted, setIsMounted] = useState(false);
  const [nodes, _, onNodesChange] = useNodesState(initialNodes);
  const [edges] = useEdgesState(initialEdges);
  const { steps } = useCurrentRun();

  // Memoize nodeTypes - workflowName is stable during a run, so this won't cause remounting
  const nodeTypes = useMemo(
    () => ({
      'default-node': (props: NodeProps<DefaultNode>) => (
        <WorkflowDefaultNode parentWorkflowName={workflowName} {...props} />
      ),
      'condition-node': WorkflowConditionNode,
      'after-node': WorkflowAfterNode,
      'loop-result-node': WorkflowLoopResultNode,
      'nested-node': (props: NodeProps<NestedNode>) => (
        <WorkflowNestedNode parentWorkflowName={workflowName} {...props} />
      ),
      'group-node': (props: NodeProps<GroupNode>) => (
        <WorkflowGroupNode parentWorkflowName={workflowName} {...props} />
      ),
    }),
    [workflowName],
  );

  useEffect(() => {
    if (open) {
      setTimeout(() => {
        setIsMounted(true);
      }, 500); // Delay to ensure modal is fully rendered
    }
  }, [open]);

  return (
    <div className="w-full h-full relative bg-surface1">
      {isMounted ? (
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
                  : steps[`${workflowName}.${e.data?.previousStepId}`]?.status === 'success' &&
                      steps[`${workflowName}.${e.data?.nextStepId}`]
                    ? '#22c55e'
                    : e.data?.conditionNode &&
                        !steps[e.data?.previousStepPath as string] &&
                        !steps[`${workflowName}.${e.data?.previousStepId}`] &&
                        (Boolean(steps[e.data?.nextStepPath as string]?.status) || Boolean(steps[`${workflowName}.${e.data?.nextStepId}`]?.status))
                      ? '#22c55e'
                      : undefined,
            },
          }))}
          fitView
          fitViewOptions={{
            maxZoom: 1,
          }}
          minZoom={0.01}
          maxZoom={1}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
        >
          <ZoomSlider position="bottom-left" />
          <Background variant={BackgroundVariant.Lines} gap={12} size={0.5} />
        </ReactFlow>
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <Spinner />
        </div>
      )}
    </div>
  );
}
