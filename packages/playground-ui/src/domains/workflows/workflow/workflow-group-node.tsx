import { Handle, Position, NodeProps, Node } from '@xyflow/react';
import { SerializedStepFlowEntry } from '@mastra/core/workflows';

import { cn } from '@/lib/utils';
import { Txt } from '@/ds/components/Txt';
import { Badge } from '@/ds/components/Badge';
import { BADGE_COLORS, BADGE_ICONS } from './workflow-node-badges';

export type GroupNode = Node<
  {
    label: string;
    stepId?: string;
    description?: string;
    withoutTopHandle?: boolean;
    withoutBottomHandle?: boolean;
    stepGraph: SerializedStepFlowEntry[];
    isForEach?: boolean;
    isParallel?: boolean;
    canSuspend?: boolean;
    // Group dimensions calculated during layout
    width: number;
    height: number;
  },
  'group-node'
>;

export interface WorkflowGroupNodeProps {
  parentWorkflowName?: string;
}

export function WorkflowGroupNode({ data, id }: NodeProps<GroupNode> & WorkflowGroupNodeProps) {
  const { label, description, withoutTopHandle, withoutBottomHandle, isForEach, isParallel, canSuspend, width, height } =
    data;

  const hasSpecialBadge = isForEach || isParallel || canSuspend;

  return (
    <>
      {!withoutTopHandle && <Handle type="target" position={Position.Top} style={{ visibility: 'hidden' }} />}
      <div
        data-testid="workflow-group-node"
        data-workflow-node
        className={cn(
          'bg-surface2/50 rounded-xl border border-dashed border-border1',
          'flex flex-col',
        )}
        style={{
          width: width,
          height: height,
          minWidth: 300,
          minHeight: 150,
        }}
      >
        {/* Group Header */}
        <div className="px-3 py-2 border-b border-dashed border-border1 bg-surface3/50 rounded-t-xl">
          <div className="flex items-center gap-2">
            {hasSpecialBadge && (
              <div className="flex gap-1.5 flex-wrap">
                {canSuspend && (
                  <Badge icon={<BADGE_ICONS.suspend className="text-current" style={{ color: BADGE_COLORS.suspend }} />}>
                    SUSPEND
                  </Badge>
                )}
                {isParallel && (
                  <Badge icon={<BADGE_ICONS.parallel className="text-current" style={{ color: BADGE_COLORS.parallel }} />}>
                    PARALLEL
                  </Badge>
                )}
                <Badge icon={<BADGE_ICONS.workflow className="text-current" style={{ color: BADGE_COLORS.workflow }} />}>
                  WORKFLOW
                </Badge>
                {isForEach && (
                  <Badge icon={<BADGE_ICONS.forEach className="text-current" style={{ color: BADGE_COLORS.forEach }} />}>
                    FOREACH
                  </Badge>
                )}
              </div>
            )}
            {!hasSpecialBadge && (
              <Badge icon={<BADGE_ICONS.workflow className="text-current" style={{ color: BADGE_COLORS.workflow }} />}>
                WORKFLOW
              </Badge>
            )}
            <Txt variant="ui-lg" className="text-icon6 font-medium">
              {label}
            </Txt>
          </div>
          {description && (
            <Txt variant="ui-sm" className="text-icon3 mt-1">
              {description}
            </Txt>
          )}
        </div>
      </div>
      {!withoutBottomHandle && <Handle type="source" position={Position.Bottom} style={{ visibility: 'hidden' }} />}
    </>
  );
}
